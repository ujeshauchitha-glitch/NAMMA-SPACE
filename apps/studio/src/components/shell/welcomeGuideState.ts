const DISMISSED_KEY = 'namma-space-welcome-dismissed.v1';

export function shouldShowWelcomeGuide(): boolean {
  if (typeof window !== 'undefined' && window.navigator.webdriver) {
    return false; // Don't block automated browser test runs
  }
  try {
    return localStorage.getItem(DISMISSED_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function setWelcomeGuideDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } else {
      localStorage.removeItem(DISMISSED_KEY);
    }
  } catch {
    // ignore local storage errors
  }
}
