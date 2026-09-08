// Token lưu trong sessionStorage (không lưu mật khẩu). Thay bằng JWT/cookie sau này tại đây.
const KEY = "vd.token";
const USER = "vd.user";

export const auth = {
  get token(): string | null {
    return sessionStorage.getItem(KEY);
  },
  get username(): string | null {
    return sessionStorage.getItem(USER);
  },
  set(token: string, username: string): void {
    sessionStorage.setItem(KEY, token);
    sessionStorage.setItem(USER, username);
  },
  clear(): void {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(USER);
  },
};
