// Framework-free types shared by lib/employees/**.
//
// `EmployeesClient` is a narrow structural subset of the Prisma client (only
// the delegates/methods the employee core actually calls), so tests can pass
// an in-memory fake instead of a real Prisma client. Production code passes
// the real `prisma` (or a `$transaction` tx client) — both satisfy this
// shape structurally, no adapter needed.

// Deliberately loose/optional: different call sites `select` different
// subsets of columns (as the real Prisma calls do), and this hand-rolled
// interface does not attempt to narrow the return type per `select` the way
// Prisma's generated types do. Each core function only reads the fields it
// asked for; tests populate whichever fields the scenario needs.
export type EmployeeRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  passwordHash?: string | null;
  verified?: boolean;
  isOwner?: boolean;
  roleId?: string | null;
  role?: { id?: string; name: string } | null;
  failedLoginAttempts?: number;
  lockedAt?: Date | null;
  isActive?: boolean;
  activeUntil?: Date | null;
  deactivatedAt?: Date | null;
  deletedAt?: Date | null;
  tenantId?: string;
  branchId?: string | null;
  assignableBranchIds?: string[];
};

export type BranchRow = { id: string; name?: string; tenantId?: string; isActive?: boolean };

export type RoleRow = { id: string; name: string; isActive: boolean; tenantId?: string };

// `args` is deliberately `any`, not `Record<string, unknown>`: the real
// Prisma client's delegate methods take exact, narrowly-typed argument
// objects (`Prisma.UserCreateArgs`, etc.), and a `Record<string, unknown>`
// parameter is not assignable to those — the real `prisma` client (or a
// `$transaction` tx client) would then fail to structurally satisfy this
// interface. `any` is bidirectionally assignable, so both the real client
// and a plain-object fake in tests satisfy it; each call site below still
// gets a typed return value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any;

// Return types are also `Args` (`any`), not the specific row types above:
// Prisma's extension-wrapped client resolves each method's return type from
// its own overloads (varying with `select`/`include`, and adding a `{}`
// union member for extension compatibility), which is never structurally
// assignable to one fixed concrete return type. `EmployeeRow`/`BranchRow`/
// `RoleRow` above document the shape core functions actually read; callers
// narrow with those when consuming a result (see lib/employees/core.ts).
export type EmployeesClient = {
  user: {
    findFirst(args: Args): Promise<Args>;
    findMany(args: Args): Promise<Args>;
    count(args: Args): Promise<Args>;
    create(args: Args): Promise<Args>;
    update(args: Args): Promise<Args>;
    delete(args: Args): Promise<Args>;
  };
  branch: {
    findFirst(args: Args): Promise<Args>;
    findMany(args: Args): Promise<Args>;
  };
  role: {
    findFirst(args: Args): Promise<Args>;
  };
  serviceOrder: {
    count(args: Args): Promise<Args>;
  };
};

// Minimal shape of the acting user the core functions need. `requireUser()`'s
// real return value (full Prisma User + tenant + role) satisfies this
// structurally.
export type EmployeeActor = {
  id: string;
  tenantId: string;
  isOwner: boolean;
};

export type EmployeeErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "OWNER_ROLE_LOCKED"
  | "OWNER_ONLY"
  | "SELF_DEACTIVATE"
  | "SELF_ACTION"
  | "LAST_OWNER"
  | "PLAN_LIMIT_REACHED"
  | "DUPLICATE"
  | "FK_CONFLICT"
  | "OPEN_ORDERS"
  | "UNKNOWN";

export type CoreErr = {
  ok: false;
  code: EmployeeErrorCode;
  error: string;
  fieldErrors?: Record<string, string>;
};

export type ValidatedEmployee = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roleId: string | null;
  branchId: string | null;
  assignableBranchIds: string[];
  isActive: boolean;
  activeUntil: Date | null;
};
