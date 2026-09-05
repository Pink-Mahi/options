"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, UserPlus, Shield } from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
  createdAt: string;
  portfolioCount: number;
}

export function AdminPanel({
  users,
  currentUser,
  userCount,
}: {
  users: AdminUser[];
  currentUser: { id: string; role: string };
  userCount: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });

    if (res.ok) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("USER");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create user");
    }
    setLoading(false);
  }

  async function handleDelete(userId: string) {
    if (!confirm("Delete this user and all their portfolio data? This cannot be undone.")) return;
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to delete user");
    }
  }

  async function handleToggleRole(userId: string, currentRole: "ADMIN" | "USER") {
    const newRole = currentRole === "ADMIN" ? "USER" : "ADMIN";
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to update role");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4" />
            Create New User
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="new-name">Name</Label>
              <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Brother's name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-email">Email</Label>
              <Input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="bro@example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-password">Password</Label>
              <Input id="new-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 chars" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-role">Role</Label>
              <Select id="new-role" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
                <option value="USER">User</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Creating…" : "Create user"}
              </Button>
            </div>
          </form>
          {error && <p className="mt-2 text-sm text-loss">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users ({userCount})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Portfolios</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "ADMIN" ? "profit" : "secondary"}>
                        {u.role === "ADMIN" && <Shield className="mr-1 h-3 w-3" />}
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{u.portfolioCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {u.id !== currentUser.id && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleToggleRole(u.id, u.role)}
                            >
                              {u.role === "ADMIN" ? "Make user" : "Make admin"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(u.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {u.id === currentUser.id && (
                          <span className="text-xs text-muted-foreground">You</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
