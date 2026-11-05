-- 0132: the AI use statement, kept in Settings while legal approves it (decided 6 Nov 2026).
-- The Super Admin edits both texts and marks them approved. Until then nobody is asked anything. Once approved, every
-- staff member accepts the current version once, in either app, and the acceptance is recorded. Changing the staff text
-- raises the version, so everyone is asked again. The family text is what the social worker gives for signature at
-- admission; the intake form records the date signed.

alter table shared.app_settings
  add column if not exists ai_consent_approved boolean not null default false,
  add column if not exists ai_consent_version integer not null default 1,
  add column if not exists ai_consent_text text not null default $text$Use of AI in ArkOS

ArkOS, Little Ark Foundation's operating system, uses third-party AI providers, currently OpenAI, for tasks inside the system: matching names, reading uploaded documents and photos, drafting summaries and analysing reports.

By continuing, you understand and agree that:

1. Information in ArkOS, which may include personal information, may be sent to these providers only to perform these functions.
2. Little Ark Foundation uses this information only for processing, analytics and other ArkOS purposes. We never sell it, and we share it only with the service providers that run ArkOS, or where the law requires.
3. OpenAI's current terms say it does not train its models on this data, and may keep it for up to 30 days for safety and abuse monitoring, longer only if the law requires.
4. AI output can be wrong. Staff check it before relying on it.$text$,
  add column if not exists ai_consent_family_text text not null default $text$Use of AI in ArkOS (for the family)

Little Ark Foundation keeps your child's and your family's records in ArkOS, its operating system. ArkOS uses AI providers from outside the foundation, currently OpenAI, to help staff match names, read documents and prepare summaries.

By signing, I understand and agree that:

1. Information about my child and my family, which may include names, birth year, address and health details, may be sent to these providers only for this work.
2. Little Ark Foundation uses it only for my child's care and for its own records and reports. It is never sold, and it is shared only with the service providers that run ArkOS, or where the law requires.
3. I may refuse or withdraw this consent at any time by telling the social worker. My child's stay and services do not depend on it.

Paggamit ng AI sa ArkOS (para sa pamilya)

Itinatala ng Little Ark Foundation ang impormasyon ng inyong anak at pamilya sa ArkOS, ang sistema nito. Gumagamit ang ArkOS ng mga serbisyo ng AI mula sa labas ng foundation, sa ngayon ang OpenAI, para tulungan ang staff sa pagtutugma ng mga pangalan, pagbasa ng mga dokumento at paghahanda ng mga buod.

Sa pagpirma, nauunawaan ko at sumasang-ayon ako na:

1. Ang impormasyon tungkol sa aking anak at pamilya, na maaaring kasama ang mga pangalan, taon ng kapanganakan, tirahan at kalusugan, ay maaaring ipadala sa mga serbisyong ito para lamang sa gawaing ito.
2. Gagamitin ito ng Little Ark Foundation para lamang sa pangangalaga sa aking anak at sa sarili nitong mga talaan at ulat. Hindi ito kailanman ibinebenta, at ibinabahagi lamang sa mga serbisyong nagpapatakbo ng ArkOS, o kung iniuutos ng batas.
3. Maaari kong tanggihan o bawiin ang pahintulot na ito anumang oras sa pamamagitan ng pagsabi sa social worker. Hindi nakasalalay dito ang pananatili at mga serbisyo para sa aking anak.$text$;

create table if not exists shared.ai_consents (
  staff_id uuid not null default auth.uid() references shared.staff (id) deferrable,
  version integer not null check (version > 0),
  accepted_at timestamptz not null default now(),
  primary key (staff_id, version)
);
comment on table shared.ai_consents is 'Who accepted which version of the AI use statement, and when (0132). Insert only.';
alter table shared.ai_consents enable row level security;
drop policy if exists "own acceptance" on shared.ai_consents;
create policy "own acceptance" on shared.ai_consents for insert to authenticated with check (staff_id = auth.uid());
drop policy if exists "own or admin reads" on shared.ai_consents;
create policy "own or admin reads" on shared.ai_consents for select to authenticated
  using (staff_id = auth.uid() or (select shared.has_role('admin')));
revoke all on shared.ai_consents from anon, public;
grant select, insert on shared.ai_consents to authenticated;

notify pgrst, 'reload schema';
