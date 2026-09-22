"use client";
import { useEffect, useState } from "react";
import { api, apiPaged } from "@/lib/api/client";
import type { ClientRow, ProjectRow } from "@/components/tasks/types";
import type { EmployeeRow } from "@/components/employees/types";

/** Options for form pickers. Archived records are excluded by the API defaults (spec 7.8). */
export function usePickers(opts: { clients?: boolean; projects?: boolean; people?: boolean } = {}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [people, setPeople] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { clients: wantClients = false, projects: wantProjects = false, people: wantPeople = false } = opts;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, p, u] = await Promise.all([
        wantClients ? apiPaged<ClientRow>("/api/clients?limit=100&status=active&sort=name").catch(() => ({ data: [] })) : { data: [] },
        wantProjects ? apiPaged<ProjectRow>("/api/projects?limit=100&sort=name").catch(() => ({ data: [] })) : { data: [] },
        wantPeople ? apiPaged<EmployeeRow>("/api/employees?limit=100&status=active&sort=name").catch(() => ({ data: [] })) : { data: [] },
      ]);
      if (cancelled) return;
      setClients(c.data); setProjects(p.data); setPeople(u.data); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [wantClients, wantProjects, wantPeople]);
  return { clients, projects, people, loading };
}

/** Company job designations (A57) for the Designation picker. */
export function useDesignations(enabled = true) {
  const [designations, setDesignations] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<{ designations: string[] }>("/api/company/designations").then((r) => { if (!cancelled) setDesignations(r.designations); }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);
  return designations;
}
