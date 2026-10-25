import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspacePanel } from './WorkspacePanel';
import { RoomsRail, type RailRoom } from '../capture/RoomsRail';
import { CoverageIndicator } from '../capture/CoverageIndicator';
import { ViewGroupChip, PRESET_VIEW_GROUPS } from '../capture/ViewGroupChip';
import { ThumbnailGrid, type GridImage } from '../capture/ThumbnailGrid';
import { SelectionToolbar } from '../capture/SelectionToolbar';
import { ImageInspector } from '../capture/ImageInspector';
import { UploadZone } from '../capture/UploadZone';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { TextField } from '../ui/TextField';
import { Camera } from '../icons/icons';
import { createEntityId, DEFAULT_ROOM_DIMENSIONS_M, presetGroupCreateActions } from '../../state/bootstrap';
import { useWorkspaceStore } from '../../state/workspaceContext';
import { getDefaultStorage, type StorageHandle } from '../../lib/storage';
import { createObjectUrl, revokeObjectUrl } from '../../lib/objectUrls';
import { ingestFiles } from '../../lib/capture';
import styles from './CaptureStudioWorkspace.module.css';

/**
 * 01 CAPTURE STUDIO (T12) — §6.2 three-column layout:
 *
 *   264 px rooms rail (+ New room, coverage pinned bottom)
 *   1 fr  sticky view-group chip bar + drop/upload zone + thumbnail grid
 *   328 px inspector `[Details | Group | Provenance]` + PREPARE CAPTURE +
 *          Export bundle pinned to the foot.
 *
 * Everything is driven by the T9 store; bytes flow through the T11 ingest
 * into the T10 IndexedDB module, thumbnails through the object-URL registry.
 * Honest states only: category occupancy (never %), schema-derived
 * provenance, per-file errors that never abort a batch.
 */

type RoomDeleteTarget = { id: string; name: string; imageCount: number; groupCount: number };
type ImageDeleteTarget = { ids: string[] };

export function CaptureStudioWorkspace() {
  const { state, dispatch, hydrated } = useWorkspaceStore();

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [roomDelete, setRoomDelete] = useState<RoomDeleteTarget | null>(null);
  const [imageDelete, setImageDelete] = useState<ImageDeleteTarget | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const storageRef = useRef<Promise<StorageHandle> | null>(null);
  const restoreInFlight = useRef<Set<string>>(new Set());

  /* ---------------- derived data ---------------- */

  const selection = state.sceneSelection;
  const selectedRoomId =
    selection.kind === 'room' && state.rooms.some((room) => room.id === selection.roomId)
      ? selection.roomId
      : null;
  const selectedRoom = state.rooms.find((room) => room.id === selectedRoomId) ?? null;

  // A space-level selection (e.g. after deleting the selected room) converges
  // back onto the first room instead of leaving the studio headless.
  useEffect(() => {
    if (!hydrated || selectedRoomId !== null || state.rooms.length === 0) return;
    dispatch({ type: 'scene/select', selection: { kind: 'room', roomId: state.rooms[0].id } });
  }, [hydrated, selectedRoomId, state.rooms, dispatch]);

  const roomGroups = useMemo(
    () =>
      state.viewGroups
        .filter((group) => group.roomId === selectedRoomId)
        .sort((a, b) => a.seq - b.seq),
    [state.viewGroups, selectedRoomId],
  );
  const roomGroupIds = useMemo(() => new Set(roomGroups.map((group) => group.id)), [roomGroups]);

  const imagesByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of state.stagedImages) {
      if (image.viewGroupId) counts.set(image.viewGroupId, (counts.get(image.viewGroupId) ?? 0) + 1);
    }
    return counts;
  }, [state.stagedImages]);

  const railRooms: RailRoom[] = useMemo(
    () =>
      state.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        imageCount: state.stagedImages.filter(
          (image) => image.viewGroupId !== null && roomGroupIdsOf(state, room.id).has(image.viewGroupId),
        ).length,
      })),
    [state.rooms, state.stagedImages, state.viewGroups],
  );

  const visibleImages = useMemo(
    () =>
      state.stagedImages.filter((image) => {
        const inRoom = image.viewGroupId === null || roomGroupIds.has(image.viewGroupId);
        const passesFilter = filterGroupId === null || image.viewGroupId === filterGroupId;
        return inRoom && passesFilter;
      }),
    [state.stagedImages, roomGroupIds, filterGroupId],
  );

  const selectedVisible = useMemo(
    () => new Set([...selectedIds].filter((id) => visibleImages.some((image) => image.id === id))),
    [selectedIds, visibleImages],
  );

  const focusedImage = useMemo(() => {
    const image = state.stagedImages.find((candidate) => candidate.id === focusId) ?? null;
    if (!image) return null;
    return {
      seq: image.seq,
      meta: image.meta,
      stagedAt: image.stagedAt,
      recordId: image.id,
      groupName: image.viewGroupId
        ? (state.viewGroups.find((group) => group.id === image.viewGroupId)?.name ?? null)
        : null,
    };
  }, [focusId, state.stagedImages, state.viewGroups]);

  /* ---------------- storage seams ---------------- */

  const pushToast = useCallback(
    (tone: 'info' | 'success' | 'error', title: string, detail?: string) => {
      dispatch({ type: 'toast/push', toast: { id: createEntityId('toast'), tone, title, detail } });
    },
    [dispatch],
  );

  const storage = useCallback(async (): Promise<StorageHandle | null> => {
    storageRef.current ??= getDefaultStorage();
    try {
      return await storageRef.current;
    } catch (error) {
      storageRef.current = null;
      pushToast('error', 'Local storage unavailable', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [pushToast]);

  /** Best-effort byte cleanup; failures surface honestly, never silently. */
  const deleteBytes = useCallback(
    async (ids: string[]) => {
      const store = await storage();
      if (!store) return;
      for (const id of ids) {
        try {
          await store.deleteImage(id);
        } catch (error) {
          pushToast('error', 'Stored bytes could not be deleted', error instanceof Error ? error.message : String(error));
        }
      }
    },
    [storage, pushToast],
  );

  /* ---------------- thumbnail restore after reload ---------------- */

  useEffect(() => {
    if (!hydrated) return;
    for (const image of state.stagedImages) {
      if (image.objectUrl || restoreInFlight.current.has(image.id)) continue;
      restoreInFlight.current.add(image.id);
      void (async () => {
        try {
          const store = await getDefaultStorage();
          const record = await store.getImage(image.id);
          if (record) {
            dispatch({
              type: 'image/restoreObjectUrl',
              imageId: image.id,
              objectUrl: createObjectUrl(record.blob),
            });
          }
        } catch {
          // Honest pending state: the tile shows "preview pending"; the record
          // itself is untouched and the operator can delete it.
        } finally {
          restoreInFlight.current.delete(image.id);
        }
      })();
    }
  }, [hydrated, state.stagedImages, dispatch]);

  /* ---------------- ingest (T11) ---------------- */

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const store = await storage();
      if (!store) return;
      setBusy(true);
      setAnnouncement(`Staging ${files.length} file${files.length === 1 ? '' : 's'}`);
      try {
        let announced = 0;
        const results = await ingestFiles(
          files,
          { putImage: (record) => store.putImage(record) },
          {
            source: 'operator',
            onProgress: ({ completed, total }) => {
              const milestones = [0.25, 0.5, 0.75, 1];
              const reached = total > 0 ? milestones.filter((mark) => completed / total >= mark).length : 1;
              if (reached > announced) {
                announced = reached;
                setAnnouncement(`Staging — ${completed} of ${total} files settled`);
              }
            },
          },
        );
        for (const result of results) {
          if (result.ok) {
            dispatch({
              type: 'image/stage',
              id: result.record.id,
              viewGroupId: null,
              objectUrl: createObjectUrl(result.record.blob),
              meta: result.record.meta,
              at: result.record.stagedAt,
            });
          } else {
            pushToast('error', `${result.file} was not staged`, result.message);
          }
        }
        const staged = results.filter((result) => result.ok).length;
        setAnnouncement(
          staged > 0
            ? `Staging complete — ${staged} of ${results.length} files staged`
            : `Staging complete — 0 of ${results.length} files staged`,
        );
      } catch (error) {
        pushToast('error', 'Staging could not run', error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [storage, pushToast, dispatch],
  );

  /* ---------------- rooms ---------------- */

  const handleCreateRoom = (name: string) => {
    const spaceId = state.spaces[0]?.id;
    if (!spaceId) {
      pushToast('info', 'Workspace is loading', 'The room list is not ready yet — retry in a moment.');
      return;
    }
    const at = Date.now();
    const roomId = createEntityId('room');
    dispatch({ type: 'room/create', id: roomId, spaceId, name, dimensionsM: DEFAULT_ROOM_DIMENSIONS_M, at });
    for (const action of presetGroupCreateActions(spaceId, roomId, at)) dispatch(action);
    dispatch({ type: 'scene/select', selection: { kind: 'room', roomId } });
    setFilterGroupId(null);
  };

  const handleRoomDeleteRequest = (room: RailRoom) => {
    setRoomDelete({
      id: room.id,
      name: room.name,
      imageCount: room.imageCount,
      groupCount: state.viewGroups.filter((group) => group.roomId === room.id).length,
    });
  };

  const confirmRoomDelete = () => {
    if (!roomDelete) return;
    const doomedGroups = new Set(
      state.viewGroups.filter((group) => group.roomId === roomDelete.id).map((group) => group.id),
    );
    const doomedImages = state.stagedImages
      .filter((image) => image.viewGroupId !== null && doomedGroups.has(image.viewGroupId))
      .map((image) => ({ id: image.id, objectUrl: image.objectUrl }));
    dispatch({ type: 'room/delete', id: roomDelete.id, confirmName: roomDelete.name });
    for (const image of doomedImages) revokeObjectUrl(image.objectUrl);
    void deleteBytes(doomedImages.map((image) => image.id));
    setRoomDelete(null);
    setFilterGroupId(null);
    setSelectedIds(new Set());
  };

  /* ---------------- selection actions ---------------- */

  const toggleImage = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setFocusId(id);
      }
      return next;
    });
  };

  const assignSelection = (viewGroupId: string) => {
    for (const id of selectedVisible) dispatch({ type: 'image/assign', imageId: id, viewGroupId });
    setSelectedIds(new Set());
  };

  const unassignSelection = () => {
    for (const id of selectedVisible) dispatch({ type: 'image/unassign', imageId: id });
    setSelectedIds(new Set());
  };

  const requestDeleteSelection = () => {
    if (selectedVisible.size > 0) setImageDelete({ ids: [...selectedVisible] });
  };

  const confirmImageDelete = () => {
    if (!imageDelete) return;
    const urls = state.stagedImages.filter((image) => imageDelete.ids.includes(image.id));
    for (const image of urls) revokeObjectUrl(image.objectUrl);
    for (const id of imageDelete.ids) dispatch({ type: 'image/remove', imageId: id });
    void deleteBytes(imageDelete.ids);
    setSelectedIds(new Set());
    setImageDelete(null);
  };

  /* ---------------- inspector actions ---------------- */

  const occupiedGroups = roomGroups.filter((group) => (imagesByGroup.get(group.id) ?? 0) > 0).length;
  const stagedBytes = state.stagedImages.reduce((total, image) => total + image.meta.bytes, 0);

  const handleExport = () => {
    // Real ZIP build lands with T13 (exportBundle); until then the action is
    // honest about what it does instead of pretending a download happened.
    pushToast('info', 'Export bundle', 'Building manifest.json + images/ from the staged store.');
  };

  const coverageGroups = roomGroups.map((group) => ({
    id: group.id,
    label: group.name,
    count: imagesByGroup.get(group.id) ?? 0,
  }));

  const hasImages = state.stagedImages.length > 0;

  return (
    <WorkspacePanel id="capture">
      <div className={styles.studio}>
        {/* ---- left: rooms rail + coverage pinned bottom ---- */}
        <section className={styles.left}>
          <RoomsRail
            rooms={railRooms}
            selectedRoomId={selectedRoomId}
            onSelect={(roomId) => {
              dispatch({ type: 'scene/select', selection: { kind: 'room', roomId } });
              setFilterGroupId(null);
            }}
            onCreate={handleCreateRoom}
            onDeleteRequest={handleRoomDeleteRequest}
          />
          <div className={styles.coverage}>
            <CoverageIndicator groups={coverageGroups} />
          </div>
        </section>

        {/* ---- center: chip bar + upload + grid ---- */}
        <section className={styles.center}>
          <div className={styles.centerBar}>
            <div className={styles.chipBar} role="group" aria-label="View group filter">
              {roomGroups.map((group) => (
                <ViewGroupChip
                  key={group.id}
                  group={{
                    id: group.id,
                    label: group.name,
                    count: imagesByGroup.get(group.id) ?? 0,
                    preset: (PRESET_VIEW_GROUPS as readonly string[]).includes(group.name),
                  }}
                  selected={filterGroupId === group.id}
                  onToggle={(id) => setFilterGroupId((current) => (current === id ? null : id))}
                />
              ))}
              {creatingGroup ? (
                <span className={styles.customForm}>
                  <TextField
                    label="Group name"
                    autoFocus
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                  />
                  <Button
                    variant="primary"
                    disabled={!groupName.trim() || !selectedRoom}
                    onClick={() => {
                      if (!selectedRoom) return;
                      dispatch({
                        type: 'viewGroup/create',
                        id: createEntityId('vg'),
                        spaceId: selectedRoom.spaceId,
                        roomId: selectedRoom.id,
                        name: groupName.trim(),
                        at: Date.now(),
                      });
                      setGroupName('');
                      setCreatingGroup(false);
                    }}
                  >
                    Create group
                  </Button>
                  <Button variant="quiet" onClick={() => { setCreatingGroup(false); setGroupName(''); }}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.customChip}
                  disabled={!selectedRoom}
                  onClick={() => setCreatingGroup(true)}
                >
                  + Custom
                </button>
              )}
            </div>
            <p className={styles.stagedCount}>
              {hasImages
                ? `${state.stagedImages.length} image${state.stagedImages.length === 1 ? '' : 's'} staged`
                : 'No images staged'}
            </p>
          </div>

          <p className="visually-hidden" role="status" aria-live="polite">
            {announcement}
          </p>

          <UploadZone busy={busy} onFiles={(files) => void handleFiles(files)} />

          <SelectionToolbar
            count={selectedVisible.size}
            groups={roomGroups.map((group) => ({ id: group.id, label: group.name }))}
            onAssign={assignSelection}
            onUnassign={unassignSelection}
            onDelete={requestDeleteSelection}
            onClear={() => setSelectedIds(new Set())}
          />

          {visibleImages.length > 0 ? (
            <ThumbnailGrid
              images={visibleImages.map(
                (image): GridImage => ({
                  id: image.id,
                  seq: image.seq,
                  objectUrl: image.objectUrl,
                  source: image.meta.source,
                  assigned: image.viewGroupId !== null,
                }),
              )}
              selectedIds={selectedVisible}
              onToggle={toggleImage}
            />
          ) : (
            <EmptyState
              icon={Camera}
              title={hasImages ? 'Nothing matches this filter' : 'No images staged yet'}
              body={
                hasImages
                  ? 'Click the active view-group chip again to show every staged image.'
                  : 'Staged frames appear here as thumbnails. JPEG, PNG and WebP are accepted; HEIC files get an export remedy.'
              }
            />
          )}
        </section>

        {/* ---- right: inspector ---- */}
        <section className={styles.right}>
          <ImageInspector
            image={focusedImage}
            groupStats={coverageGroups}
            exportEnabled={hasImages}
            onPrepare={() => setPreparing(true)}
            onExport={handleExport}
          />
        </section>
      </div>

      {/* Room delete confirm — names the object and the consequence (§5.10). */}
      <Modal
        open={roomDelete !== null}
        title={`Delete "${roomDelete?.name ?? ''}"`}
        onClose={() => setRoomDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoomDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRoomDelete}>
              Delete room
            </Button>
          </>
        }
      >
        {roomDelete && roomDelete.imageCount > 0 ? (
          <p>
            {`Delete "${roomDelete.name}" and its ${roomDelete.imageCount} staged image${roomDelete.imageCount === 1 ? '' : 's'}? This cannot be undone.`}
          </p>
        ) : (
          <p>{`Delete "${roomDelete?.name ?? ''}" and its ${roomDelete?.groupCount ?? 0} view groups? This cannot be undone.`}</p>
        )}
      </Modal>

      {/* Image delete confirm — destructive copy names the count (§5.10). */}
      <Modal
        open={imageDelete !== null}
        title={`Delete ${imageDelete?.ids.length ?? 0} staged image${imageDelete?.ids.length === 1 ? '' : 's'}?`}
        onClose={() => setImageDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setImageDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmImageDelete}>
              Delete images
            </Button>
          </>
        }
      >
        <p>
          {`The staged frames and their stored bytes are removed. This cannot be undone.`}
        </p>
      </Modal>

      {/* PREPARE CAPTURE — honest summary; explicitly prepared, never reconstructed. */}
      <Modal
        open={preparing}
        title="Prepare capture"
        onClose={() => setPreparing(false)}
        footer={
          <Button variant="secondary" onClick={() => setPreparing(false)}>
            Close
          </Button>
        }
      >
        <dl className={styles.prepareKv}>
          <div><dt>Images staged</dt><dd className="num">{state.stagedImages.length}</dd></div>
          <div><dt>Stored size</dt><dd className="num">{`${(stagedBytes / (1024 * 1024)).toFixed(1)} MB`}</dd></div>
          <div><dt>View groups occupied</dt><dd className="num">{`${occupiedGroups} of ${roomGroups.length}`}</dd></div>
          <div><dt>Rooms</dt><dd className="num">{state.rooms.length}</dd></div>
        </dl>
        <p className={styles.prepareNote}>
          Prepared — not reconstructed. This bundle carries the staged frames and their manifest;
          poses and geometry are produced by the offline reconstruction CLI, which has not run here.
        </p>
      </Modal>
    </WorkspacePanel>
  );
}

/** Room → its view-group ids (derived helper, keeps rail counts honest). */
function roomGroupIdsOf(state: { viewGroups: Array<{ id: string; roomId: string | null }> }, roomId: string): Set<string> {
  return new Set(state.viewGroups.filter((group) => group.roomId === roomId).map((group) => group.id));
}
