import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { Close, Room as RoomIcon } from '../icons/icons';
import styles from './RoomsRail.module.css';

/**
 * Rooms rail (§5.4/§6.2 left column): 40 px rows — `[icon][name][count]`,
 * FLIP-ready flat markup (T23 animates the new row), `+ New room` form at
 * the top, delete behind a confirm that names the room (§5.10). Rows are
 * real `<button>`s — never clickable divs.
 */
export type RailRoom = {
  id: string;
  name: string;
  /** Images assigned into this room's view groups. */
  imageCount: number;
};

export type RoomsRailProps = {
  rooms: RailRoom[];
  selectedRoomId: string | null;
  onSelect: (roomId: string) => void;
  onCreate: (name: string) => void;
  onDeleteRequest: (room: RailRoom) => void;
};

export function RoomsRail({ rooms, selectedRoomId, onSelect, onCreate, onDeleteRequest }: RoomsRailProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <nav className={styles.rail} aria-label="Rooms">
      <header className={styles.header}>
        <span className={styles.title}>Rooms</span>
        {!creating && (
          <Button variant="quiet" onClick={() => setCreating(true)}>
            + New room
          </Button>
        )}
      </header>

      {creating && (
        <form className={styles.form} onSubmit={submit}>
          <TextField
            label="Room name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <div className={styles.formActions}>
            <Button variant="primary" type="submit" disabled={!name.trim()}>
              Create room
            </Button>
            <Button variant="quiet" onClick={() => { setCreating(false); setName(''); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rooms.length === 0 && !creating && (
        <p className={styles.empty}>No rooms yet. Create one to stage images against its view groups.</p>
      )}

      <ul className={styles.list}>
        {rooms.map((room) => {
          const selected = room.id === selectedRoomId;
          return (
            <li key={room.id} className={styles.row} data-room-id={room.id}>
              <button
                type="button"
                className={[styles.rowButton, selected ? styles.rowSelected : ''].filter(Boolean).join(' ')}
                aria-label={room.name}
                aria-pressed={selected}
                onClick={() => onSelect(room.id)}
              >
                <RoomIcon className={styles.rowIcon} />
                <span className={styles.rowName}>{room.name}</span>
                <span className={styles.rowCount}>{`${room.imageCount} imgs`}</span>
              </button>
              <button
                type="button"
                className={styles.rowDelete}
                aria-label={`Delete ${room.name}`}
                onClick={() => onDeleteRequest(room)}
              >
                <Close />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
