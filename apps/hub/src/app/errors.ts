/**
 * One shape for every failure the hub returns. `code` is for companion to
 * branch on; `message` is for whoever is reading a terminal.
 */
export interface ErrorBody {
  error: { code: string; message: string };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}
