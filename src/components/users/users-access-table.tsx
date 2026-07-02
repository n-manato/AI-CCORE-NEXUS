"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, RefreshCw, KeyRound, LockKeyhole, Ban, Check, UserPlus, Save } from "lucide-react";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal, ConfirmDialog } from "@/components/ui/dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { AdminActionButton } from "@/components/ui/admin-action-button";
import { CATEGORIES, type Category } from "@/lib/constants";
import { maskKey } from "@/lib/apikey";
import { postJson } from "@/lib/client";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  key: { prefix: string; last4: string; status: string } | null;
  access: Record<string, boolean>;
}

type AccessDraft = Record<string, Record<string, boolean>>;

export function UsersAccessTable({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<AccessDraft>(() =>
    Object.fromEntries(users.map((u) => [u.id, { ...u.access }])),
  );
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(userId: string, cat: Category) {
    setDraft((d) => ({ ...d, [userId]: { ...d[userId], [cat]: !d[userId][cat] } }));
  }

  function isDirty(u: UserRow) {
    return CATEGORIES.some((c) => (draft[u.id]?.[c] ?? false) !== (u.access[c] ?? false));
  }

  async function saveAccess(u: UserRow) {
    await postJson("/api/users/access", { userId: u.id, access: draft[u.id] });
    router.refresh();
  }

  async function reveal(u: UserRow) {
    setError(null);
    try {
      const res = await postJson<{ key: string }>("/api/keys/reveal", { userId: u.id });
      setRevealed({ name: u.name, key: res.key });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function regenerate(u: UserRow) {
    const res = await postJson<{ key: string }>("/api/keys/regenerate", { userId: u.id });
    setNewKey({ name: u.name, key: res.key });
    router.refresh();
  }

  async function setKeyStatus(u: UserRow, status: "active" | "disabled") {
    await postJson("/api/keys/status", { userId: u.id, status });
    router.refresh();
  }

  async function setUserStatus(u: UserRow, status: "active" | "disabled") {
    await postJson("/api/users/status", { userId: u.id, status });
    router.refresh();
  }

  async function setRole(u: UserRow, role: string) {
    await postJson("/api/users/update", { userId: u.id, role });
    router.refresh();
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted">
          Admin can manage every user&apos;s password and API access. Sensitive values are never
          written to the audit log.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <TableWrap>
        <THead>
          <TR>
            <TH>User</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>API Key</TH>
            <TH>API Access</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD>
                <div className="font-medium text-ink">{u.name}</div>
                <div className="text-xs text-muted">{u.email}</div>
              </TD>
              <TD>
                <Select
                  value={u.role}
                  onChange={(e) => setRole(u, e.target.value)}
                  className="h-8 w-28"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </Select>
              </TD>
              <TD>
                <StatusBadge status={u.status} />
              </TD>
              <TD>
                {u.key ? (
                  <div className="flex items-center gap-1.5">
                    <code className="rounded bg-bg-base px-1.5 py-0.5 font-mono text-xs text-ink-dim">
                      {maskKey(u.key.prefix, u.key.last4)}
                    </code>
                    <StatusBadge status={u.key.status === "active" ? "active" : "Disabled"} dot={false} />
                  </div>
                ) : (
                  <span className="text-xs text-muted">No key</span>
                )}
              </TD>
              <TD>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const on = draft[u.id]?.[c] ?? false;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggle(u.id, c)}
                        className={
                          "rounded-md border px-1.5 py-0.5 text-[11px] transition-colors " +
                          (on
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-border bg-bg-base text-muted hover:text-ink")
                        }
                        title={`${c}: ${on ? "Enabled" : "Disabled"}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                {isDirty(u) && (
                  <button
                    onClick={() => saveAccess(u)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <Save className="h-3 w-3" /> Save changes
                  </button>
                )}
              </TD>
              <TD>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setPasswordUser(u)}>
                    <LockKeyhole className="h-3.5 w-3.5" /> Password
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => reveal(u)} disabled={!u.key}>
                    <Eye className="h-3.5 w-3.5" /> Reveal
                  </Button>
                  <AdminActionButton
                    label="Regenerate"
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    confirmTitle={`Regenerate key for ${u.name}?`}
                    confirmMessage="The current key is invalidated immediately. Any apps using it will stop working until updated."
                    onConfirm={() => regenerate(u)}
                  />
                  {u.key?.status === "active" ? (
                    <AdminActionButton
                      label="Disable Key"
                      icon={<KeyRound className="h-3.5 w-3.5" />}
                      danger
                      confirmTitle={`Disable key for ${u.name}?`}
                      confirmMessage="The key will stop working immediately."
                      onConfirm={() => setKeyStatus(u, "disabled")}
                      disabled={!u.key}
                    />
                  ) : (
                    u.key && (
                      <AdminActionButton
                        label="Enable Key"
                        icon={<Check className="h-3.5 w-3.5" />}
                        requireConfirm={false}
                        onConfirm={() => setKeyStatus(u, "active")}
                      />
                    )
                  )}
                  {u.status === "active" ? (
                    <AdminActionButton
                      label="Disable User"
                      icon={<Ban className="h-3.5 w-3.5" />}
                      danger
                      confirmTitle={`Disable ${u.name}?`}
                      confirmMessage="The user will be unable to log in or use any API until re-enabled."
                      onConfirm={() => setUserStatus(u, "disabled")}
                    />
                  ) : (
                    <AdminActionButton
                      label="Enable User"
                      icon={<Check className="h-3.5 w-3.5" />}
                      requireConfirm={false}
                      onConfirm={() => setUserStatus(u, "active")}
                    />
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>

      {/* Reveal key modal */}
      <Modal open={!!revealed} onClose={() => setRevealed(null)} title={`API key - ${revealed?.name}`}>
        <p className="mb-2 text-xs text-warn">
          Handle this value carefully. It is shown for copying only and is never written to logs.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-bg-base px-2 py-1.5 font-mono text-xs text-ink">
            {revealed?.key}
          </code>
          <CopyButton text={revealed?.key} />
        </div>
      </Modal>

      {/* New key modal (after regenerate / create) */}
      <Modal open={!!newKey} onClose={() => setNewKey(null)} title={`New API key - ${newKey?.name}`}>
        <p className="mb-2 text-xs text-warn">
          Copy this key now. You can reveal it again later from this page, but the previous key is
          already invalidated.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-bg-base px-2 py-1.5 font-mono text-xs text-ink">
            {newKey?.key}
          </code>
          <CopyButton text={newKey?.key} />
        </div>
      </Modal>

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(name, key) => {
          setAddOpen(false);
          setNewKey({ name, key });
          router.refresh();
        }}
      />

      <ChangePasswordModal
        user={passwordUser}
        onClose={() => setPasswordUser(null)}
        onChanged={() => setPasswordUser(null)}
      />
    </>
  );
}

function ChangePasswordModal({
  user,
  onClose,
  onChanged,
}: {
  user: UserRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setPassword("");
    setConfirm("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (!user) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/users/password", { userId: user.id, password });
      setPassword("");
      setConfirm("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!user} onClose={close} title={`Change password — ${user?.name ?? ""}`}>
      <p className="mb-3 text-xs text-muted">
        This replaces the user&apos;s login password immediately. The password is never displayed or logged.
      </p>
      <div className="space-y-3">
        <div>
          <Label htmlFor="admin-new-password">New password (8–128 characters)</Label>
          <Input
            id="admin-new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <Label htmlFor="admin-confirm-password">Confirm new password</Label>
          <Input
            id="admin-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && password.length >= 8 && password === confirm && submit()}
            disabled={busy}
          />
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={busy || password.length < 8 || password.length > 128 || password !== confirm}
        >
          {busy ? "Changing..." : "Change password"}
        </Button>
      </div>
    </Modal>
  );
}

function AddUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, key: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await postJson<{ key: string }>("/api/users", {
        name,
        email,
        password,
        role,
        access,
      });
      onCreated(name, res.key);
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
      setAccess({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add user">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-10">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@lab.local" />
        </div>
        <div>
          <Label>Temporary password (min 8 chars)</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
          />
        </div>
        <div>
          <Label>Initial API access</Label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const on = access[c] ?? false;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccess((a) => ({ ...a, [c]: !on }))}
                  className={
                    "rounded-md border px-2 py-1 text-xs " +
                    (on
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border bg-bg-base text-muted")
                  }
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={busy || !name || !email || password.length < 8}>
          {busy ? "Creating..." : "Create user"}
        </Button>
      </div>
    </Modal>
  );
}
