import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';

/**
 * Read a file without a check-then-use window.
 *
 * `statSync(path)` followed by `readFileSync(path)` leaves a gap in which the
 * path can be replaced, so the file that was validated is not necessarily the
 * file that is read. Opening with O_NOFOLLOW makes the open itself refuse a
 * symlink, and `fstatSync` on the descriptor describes the file actually
 * opened rather than the path.
 *
 * Returns null when the path is not a regular file or cannot be opened.
 */
export function readFileNoFollow(path, options) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd, options);
  } finally {
    closeSync(fd);
  }
}
