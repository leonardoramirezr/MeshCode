/** Chat settings remembered across launches. */
export const preferences = {
  get: (key: string) => {
    try {
      return localStorage.getItem(`meshcode.chat.${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(`meshcode.chat.${key}`);
      else localStorage.setItem(`meshcode.chat.${key}`, value);
    } catch {
      // Preferences are a convenience; ignore storage failures.
    }
  },
};
