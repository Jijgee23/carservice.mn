// Framework-free types shared by lib/roles/**. See lib/employees/types.ts
// for the rationale behind the loose/optional row shape.

export type RoleRow = {
  id: string;
  name?: string;
  description?: string | null;
  permissions?: string[];
  isActive?: boolean;
  key?: string | null;
  _count?: { users: number };
};

// See lib/employees/types.ts's `Args` comment for why this is `any` rather
// than `Record<string, unknown>`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any;

// Return types are `Args` (`any`) for the same reason documented in
// lib/employees/types.ts: Prisma's extension-wrapped client's per-overload
// return types are never structurally assignable to one fixed concrete type.
export type RolesClient = {
  role: {
    findFirst(args: Args): Promise<Args>;
    create(args: Args): Promise<Args>;
    update(args: Args): Promise<Args>;
    delete(args: Args): Promise<Args>;
  };
};

export type ValidatedRole = {
  name: string;
  description: string | null;
  permissions: string[];
  isActive: boolean;
};
