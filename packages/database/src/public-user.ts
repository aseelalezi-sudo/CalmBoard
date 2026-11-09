import { users } from "./schema.js";

// An allowlist for users embedded in collaboration responses. Keep authentication
// and account security state out of these queries, including future schema fields.
export const collaborationUserSelection = {
  id: users.id,
  name: users.name,
  email: users.email,
  avatarUrl: users.avatarUrl,
  locale: users.locale,
  skills: users.skills,
};
