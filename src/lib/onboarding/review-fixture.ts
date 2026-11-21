import type { TeamManagementState } from "./management";

export const reviewUser = { id: "11111111-1111-4111-8111-111111111111", name: "Captain", profileImageUrl: "" };
const reviewMemberId = "88888888-8888-4888-8888-888888888888";

export const reviewGroup = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Shared review",
  ownerId: reviewUser.id,
  memberTypes: [],
  members: [{
    id: reviewMemberId,
    userId: reviewUser.id,
    roles: [],
    memberType: "",
    isPlaceholder: false,
    user: reviewUser,
  }],
};

export const reviewTeamPath = `/groups/${reviewGroup.id}`;
export const reviewTeamApi = `/api/team-onboarding/${reviewGroup.id}`;
export const reviewRosterState: TeamManagementState = {
  config: { name: reviewGroup.name, includeUsta: false, teamNumber: "", deadline: "" },
  members: [{ id: reviewMemberId, userId: reviewUser.id, name: reviewUser.name }],
  players: [],
  legacyInvitations: [],
};
