import type { RailOwner } from './conversation-rail';
import { ConversationOwnerSelect } from './ConversationOwnerSelect';
import { UserOrganizationSelect } from './UserOrganizationSelect';
import type { OrganizationFilterOption } from '../../shared/organization-mapping';

export function ConversationFilters({
  owners,
  total,
  selectedOwners,
  organizations,
  selectedOrganizations,
  onOwnersChange,
  onOrganizationsChange,
}: {
  owners: readonly RailOwner[];
  total: number;
  selectedOwners: readonly string[];
  organizations: readonly OrganizationFilterOption[];
  selectedOrganizations: readonly string[];
  onOwnersChange: (selected: readonly string[]) => void;
  onOrganizationsChange: (selected: readonly string[]) => void;
}) {
  return (
    <>
      <ConversationOwnerSelect owners={owners} total={total} selected={selectedOwners} onChange={onOwnersChange} />
      <UserOrganizationSelect
        organizations={organizations}
        total={total}
        selected={selectedOrganizations}
        onChange={onOrganizationsChange}
        label="Organizations represented in conversations"
        ariaLabel="Filter conversations by organization"
      />
    </>
  );
}
