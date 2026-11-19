"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FolderKanban, Plus, Save, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type ProjectHub = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  color: string;
  conversationCount: number;
};

export function ProjectHubsModal({
  open,
  activeConversationId,
  activeProjectId,
  onClose,
  onAssigned,
}: {
  open: boolean;
  activeConversationId: string | null;
  activeProjectId?: string | null;
  onClose: () => void;
  onAssigned: (projectId: string | null, instructions: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectHub[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  const loadProjects = useCallback(async () => {
    try {
      const res = await apiFetch("/api/projects");
      const data = await res.json() as { projects?: ProjectHub[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load your projects");
      const nextProjects = data.projects ?? [];
      setProjects(nextProjects);
      const nextId = activeProjectId && nextProjects.some((p) => p.id === activeProjectId)
        ? activeProjectId
        : nextProjects[0]?.id ?? null;
      setSelectedId(nextId);
      const nextSelected = nextProjects.find((project) => project.id === nextId);
      setName(nextSelected?.name ?? "");
      setDescription(nextSelected?.description ?? "");
      setInstructions(nextSelected?.instructions ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your projects");
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void loadProjects(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open, loadProjects]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(selected ? `/api/projects/${selected.id}` : "/api/projects", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, instructions }),
      });
      const data = await res.json() as { project?: ProjectHub; error?: string };
      if (!res.ok || !data.project) throw new Error(data.error || "Project could not be saved");
      setProjects((current) => selected
        ? current.map((item) => item.id === data.project!.id ? { ...item, ...data.project! } : item)
        : [data.project!, ...current]);
      setSelectedId(data.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const createNew = () => {
    setSelectedId(null);
    setName("");
    setDescription("");
    setInstructions("");
    setError("");
  };

  const assign = async (projectId: string | null) => {
    if (!activeConversationId) {
      setError("Open or send a chat first, then choose the project for that conversation.");
      return;
    }
    const project = projects.find((item) => item.id === projectId);
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/conversations/${activeConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, systemPrompt: project?.instructions ?? "" }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update this conversation");
      onAssigned(projectId, project?.instructions ?? "");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this conversation");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete “${selected.name}”? Its chats will remain, but will be unassigned.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${selected.id}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || "Project could not be deleted");
      setProjects((current) => current.filter((project) => project.id !== selected.id));
      setSelectedId(null);
      setName(""); setDescription(""); setInstructions("");
      if (activeProjectId === selected.id) onAssigned(null, "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project could not be deleted");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="project-hubs-title" className="w-full max-w-4xl h-[min(680px,92vh)] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] shadow-2xl flex flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3"><FolderKanban className="h-5 w-5 text-[var(--accent)]"/><div><h2 id="project-hubs-title" className="font-semibold text-[var(--text-primary)]">Project Hubs</h2><p className="text-xs text-[var(--text-muted)]">Keep related chats and project-specific instructions together.</p></div></div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"><X className="h-4 w-4"/></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[250px_1fr]">
          <aside className="border-b border-[var(--border-subtle)] p-3 md:border-b-0 md:border-r overflow-y-auto">
            <button type="button" onClick={createNew} className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"><Plus className="h-4 w-4"/>New project</button>
            <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
              {projects.map((project) => <button type="button" key={project.id} onClick={() => { setSelectedId(project.id); setName(project.name); setDescription(project.description); setInstructions(project.instructions); setError(""); }} className={`min-w-[150px] rounded-xl border px-3 py-3 text-left transition md:min-w-0 ${selectedId === project.id ? "border-[var(--accent)] bg-[var(--bg-elevated)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"}`}><span className="block truncate text-sm font-medium text-[var(--text-primary)]">{project.name}</span><span className="mt-1 block text-xs text-[var(--text-muted)]">{project.conversationCount} {project.conversationCount === 1 ? "chat" : "chats"}</span></button>)}
            </div>
            {projects.length === 0 && <p className="px-2 py-4 text-xs text-[var(--text-muted)]">No projects yet. Create one to save shared context.</p>}
          </aside>
          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-2xl space-y-4">
              <div><label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Project name</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Website redesign" className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"/></div>
              <div><label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What are you working on?" className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"/></div>
              <div><label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Project instructions</label><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={8000} rows={9} placeholder="Architecture, conventions, preferred tone, decisions, or context that should follow this project’s chats…" className="w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"/><p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">{instructions.length}/8000</p></div>
              {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4">
                <div className="flex gap-2">{selected && <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5"/>Delete</button>}{selected && <button type="button" disabled={busy} onClick={() => void assign(null)} className="rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50">Remove from chat</button>}</div>
                <div className="ml-auto flex gap-2"><button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"><Save className="h-3.5 w-3.5"/>{selected ? "Save changes" : "Create project"}</button>{selected && <button type="button" disabled={busy || !activeConversationId} onClick={() => void assign(selected.id)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Use for this chat</button>}</div>
              </div>
              {!activeConversationId && <p className="text-right text-xs text-[var(--text-muted)]">Start a chat before assigning it to a project.</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
