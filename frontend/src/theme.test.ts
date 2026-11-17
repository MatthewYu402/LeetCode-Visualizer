import { describe, expect, it } from "vitest";
import { initialTheme } from "./theme";

describe("initialTheme", () => {
  it("a theme picked before wins over the system's setting", () => {
    expect(initialTheme("light", false)).toBe("light");
    expect(initialTheme("dark", true)).toBe("dark");
  });

  it("with nothing picked, it follows the system: light when the system is light, else dark", () => {
    expect(initialTheme(null, true)).toBe("light");
    expect(initialTheme(null, false)).toBe("dark");
  });

  it("an unknown stored value is ignored", () => {
    expect(initialTheme("sepia", true)).toBe("light");
    expect(initialTheme("", false)).toBe("dark");
  });
});
