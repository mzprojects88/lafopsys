# LAF Operating System — design system

Source of truth for how screens look. The same design as the LAF Inventory app (`../laf-inventory/DESIGN.md`): TailAdmin Pro's design language (surfaces, grays, shadows, layout) on shadcn primitives, with LAF blue as the one accent, so both apps read as one product. The previous look (stock shadcn "radix-nova", Geist, an HSL slate palette, a colour per module) is the anti-reference.

## Read

Operate mode, trust-first. Dials: variance 4 · motion 3 · density 5. Two form factors, one product: below `lg` the phone app (top bar, one column, bottom tabs Home · Patients · Time · Calendar · More); from `lg` the admin layout (sidebar 290/90 px, header 64 px, content to 1536 px).

## Tokens (`app/globals.css`, shared with inventory — change both together)

- **Type.** Outfit for everything (`--font-sans`, headings included); Geist Mono for codes, IDs and CNs. Scale: `text-theme-xs` 12/18, `text-theme-sm` 14/20, base 16, `text-lg` 18, `text-xl` 20 (page titles), `text-2xl` 24 (greeting), `text-title-sm` 30/38 (stat values on desk). Weights: 400 body, 500 labels and nav, 600 titles, 700 stat values. Figures are always tabular.
- **Color, light.** Ground `#f9fafb`, card `#ffffff`, border `#e4e7ec`, input border `#d0d5dd`, text `#1d2939`, muted text `#667085`, muted surface `#f2f4f7`. Accent `#2563eb` (primary actions, active nav, links, focus ring), accent wash `bg-accent text-accent-foreground`. Status: `success`, `warning`, `info`, `destructive`, each with a `-foreground` text pair.
- **Color, dark.** Ground `#101828`, card `#171f2e`, popover `#1d2939`, hairline borders, accent `#3b82f6`, status lifted one step. Never pure black.
- **Colour means something.** Blue is the only accent. Green / amber / red / sky are for status (ok, needs attention, problem, informational) through `lib/utils/status-colors.ts` tones. Categorical colours only where they encode data: calendar event types, chart series (`var(--chart-N)`), floor-plan bed states. Modules have no colours of their own. No Tailwind palette classes (`bg-amber-50`, `text-emerald-700`…) in pages or components; print pages are the one exception (fixed ink).
- **Radius.** `rounded-lg` inputs, buttons, nav items · `rounded-xl` icon squares, small cards · `rounded-2xl` cards, tables, stat tiles · `rounded-3xl` dialogs · `rounded-full` badges, avatars.
- **Shadow.** `shadow-theme-xs` on inputs and primary buttons, `shadow-theme-lg` on dialogs, sheets and menus. No glows.
- **Focus.** 3 px ring at `ring/20` plus the accent border.

## Surfaces and components

- **PageHeader.** Breadcrumbs, then the page title (`text-xl font-semibold`) with its description; actions and the module sub-menu on the right.
- **Card / SectionCard.** `rounded-2xl border border-border bg-card`; header `px-5 py-4` with a 16 px medium title, then `border-t`; body `p-5`, or flush for tables and lists (`divide-y`, rows `px-5 py-3`). Never a card inside a card.
- **KpiCard (StatCard).** Icon in a `size-12 rounded-xl` square (muted, or tinted for warning / negative / positive), label 14 px muted, value 30 px bold. Compact on phones.
- **DataTable.** Bordered `rounded-2xl` card, header row 12 px muted, rows `px-5 py-3` 14 px, hairline dividers, hover `bg-muted/60`, "Showing x to y of n". Phones get cards from the same rows.
- **StatusBadge.** Pill, `bg-<tone>/12 text-<tone>-foreground`, 12 px medium.
- **Buttons.** Primary, outline (`bg-card shadow-theme-xs`), ghost for row actions. Heights 40 default, 44 large, 28 small.
- **Inputs.** 44 px, label above, helper and error below. No placeholder-as-label.
- **Dialogs / sheets / menus.** Panel `rounded-3xl bg-card p-6 shadow-theme-lg` (sheets and menus share the card surface and shadow), veil `gray-900/40` blurred.
- **Empty states.** Dashed `rounded-2xl` card, icon square, one line that says what fills it, one action.
- **Loading.** Skeleton rows (`LoadingState`), never "Loading…" text or spinners in content.
- **Icons.** lucide, `strokeWidth` 1.75, sizes 16/20/24.

## Layout

- Phone: sticky top bar 56 px (title, account sheet), content `px-4 pt-4 pb-24`, bottom tabs with safe-area padding. More opens every other module the person can see.
- Desk: sidebar groups **Main** (Dashboard, Calendar) · **Work** (Patients … Compliances) · **Manage** (Analytics, Reports, Executive, Settings), in the order the org set in `lib/rbac/roles.ts`; hidden modules (`NEXT_PUBLIC_HIDDEN_ROUTES`) never render. Header 64 px: sidebar toggle, search (⌘K), clock status, theme, notifications, account. Content `px-6 pt-6`, lists and dashboards to `max-w-(--breakpoint-2xl)`, forms and details `max-w-3xl`.
- Sign-in (staff and donor portal): the split layout — form left, navy brand panel right; on phones the form above the wave.
- Print pages: white paper, Outfit, fixed ink colours; nothing from the app shell.

## Motion

150–200 ms ease-out on hover, sidebar width and dialog entry. Nothing else moves.

## Do not

Eyebrows and section numbers; gradient text; coloured left borders; nested cards; a colour per module; Inter; pure black; spinners or "Loading…" in content; placeholder labels; fake data.
