// check zod uuid validation against the seeded template id
import { z } from 'zod';
const candidates = [
  '00000000-0000-0000-0000-000000000010',
  '123e4567-e89b-12d3-a456-426614174000',
];
for (const c of candidates) {
  console.log(c, '->', z.string().uuid().safeParse(c).success);
}
