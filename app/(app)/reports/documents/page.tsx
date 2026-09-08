"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronRight, ExternalLink, FileText, Folder, FolderOpen, Search, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FileLibrary, openStoredFile } from "@/components/patterns/file-library";
import { deleteFile } from "@/app/(app)/files/actions";
import { allFilesStore, useAllFiles } from "@/lib/hooks/use-files-collection";
import { useRole } from "@/lib/rbac/use-role";
import { canDeleteFiles, canUploadFiles } from "@/lib/rbac/roles";
import { formatBytes } from "@/lib/utils/file-paths";
import { formatDate } from "@/lib/utils/date";
import { FILE_MODULE_LABELS, type StoredFile } from "@/lib/types/files";

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  files: StoredFile[];
  count: number;
}

function buildTree(files: StoredFile[]): Node {
  const root: Node = { name: "", path: "", children: new Map(), files: [], count: 0 };
  for (const f of files) {
    let node = root;
    node.count += 1;
    for (const seg of f.folder.split("/")) {
      let next = node.children.get(seg);
      if (!next) {
        next = { name: seg, path: node.path ? `${node.path}/${seg}` : seg, children: new Map(), files: [], count: 0 };
        node.children.set(seg, next);
      }
      node = next;
      node.count += 1;
    }
    node.files.push(f);
  }
  return root;
}

/**
 * Every file in the bucket the viewer may see, laid out as the bucket is:
 * by main menu, then by record (or agency and period). Search cuts across
 * folders. Files are added on the record they belong to; the one folder
 * that is added here is Reports, for board packs and other general papers.
 */
export default function DocumentsPage() {
  const { role, isHr } = useRole();
  const { files, loading, error } = useAllFiles();
  const [search, setSearch] = React.useState("");
  // The six menu folders start open so the first view reads like the menu.
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(["HR", "Compliances", "Patients", "Donors", "Financial", "Reports"]));
  const [confirmDelete, setConfirmDelete] = React.useState<StoredFile | null>(null);
  const [busy, setBusy] = React.useState(false);

  const q = search.trim().toLowerCase();
  const shown = q ? files.filter((f) => f.fileName.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)) : files;
  const tree = React.useMemo(() => buildTree(shown), [shown]);
  const byModule = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) m.set(f.module, (m.get(f.module) ?? 0) + 1);
    return m;
  }, [files]);
  const totalBytes = files.reduce((a, f) => a + f.sizeBytes, 0);

  const toggle = (path: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const r = await deleteFile(confirmDelete.id);
    setBusy(false);
    setConfirmDelete(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await allFilesStore.refetch();
    toast.success("File removed.");
  }

  function renderNode(node: Node, depth: number): React.ReactNode {
    const expanded = node.path === "" || q.length > 0 || open.has(node.path);
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    const canDelete = (f: StoredFile) => canDeleteFiles(f.module, role, isHr);
    return (
      <div key={node.path}>
        {node.path ? (
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted" style={{ paddingLeft: `${depth * 16 + 8}px` }} onClick={() => toggle(node.path)}>
            <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
            {expanded ? <FolderOpen className="size-4 shrink-0 text-amber-600" /> : <Folder className="size-4 shrink-0 text-amber-600" />}
            <span className="truncate font-medium">{node.name}</span>
            <span className="text-xs text-muted-foreground">{node.count}</span>
          </button>
        ) : null}
        {expanded ? (
          <>
            {children.map((c) => renderNode(c, node.path ? depth + 1 : depth))}
            {node.files.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted" style={{ paddingLeft: `${(node.path ? depth + 1 : depth) * 16 + 8}px` }}>
                <button type="button" className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => void openStoredFile(f.id)}>
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt, "MMM d, yyyy")}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" aria-label="Open" onClick={() => void openStoredFile(f.id)}>
                    <ExternalLink className="size-3.5" />
                  </Button>
                  {canDelete(f) ? (
                    <Button size="sm" variant="ghost" aria-label="Remove" className="text-rose-700" onClick={() => setConfirmDelete(f)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Documents" description="Every file kept in the foundation's bucket that you may see, arranged as the menus are: HR, Compliances, Patients, Donors, Financial, Reports." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Files" value={loading ? "…" : files.length} icon={FileText} color="blue" sublabel={formatBytes(totalBytes)} />
        <KpiCard label="HR · 201 files" value={loading ? "…" : (byModule.get("hr") ?? 0)} icon={Folder} color="indigo" />
        <KpiCard label="Compliances" value={loading ? "…" : (byModule.get("compliance") ?? 0)} icon={Folder} color="amber" />
        <KpiCard label="Patients · Donors · Financial" value={loading ? "…" : (byModule.get("patients") ?? 0) + (byModule.get("donors") ?? 0) + (byModule.get("finance") ?? 0)} icon={Folder} color="teal" />
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search file names and folders…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search files" />
      </div>

      {error ? (
        <EmptyState title="Couldn't load the files" description={error} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Folders</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && files.length === 0 ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? <p className="text-sm text-muted-foreground">{q ? "Nothing matches." : "No files yet. Add them on an employee, obligation, patient, donor or bank import, or below under Reports."}</p> : renderNode(tree, 0)}
          </CardContent>
        </Card>
      )}

      <FileLibrary recordType="general" recordId="Board packs" canUpload={canUploadFiles("reports", role, isHr)} canDelete={canDeleteFiles("reports", role, isHr)} title="Reports · Board packs" description="General papers that belong to no single record: board packs, annual reports, policies. Kept under Reports / Board packs." />

      <p className="text-xs text-muted-foreground">
        <Upload className="mr-1 inline size-3" />
        Files are added where they belong: an employee&apos;s Documents tab, a deadline on Compliances, a patient or donor&apos;s Documents tab, or a bank import. Every module&apos;s own rules decide who may add, see and remove.
      </p>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => (o ? undefined : setConfirmDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{confirmDelete?.fileName}&rdquo; ({confirmDelete ? FILE_MODULE_LABELS[confirmDelete.module] : ""}) is deleted from the bucket as well. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
