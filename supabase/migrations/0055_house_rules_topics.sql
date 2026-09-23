-- 0055: the house's own rules become the orientation list. Taken word for
-- word from the sheet posted at LAF House ("Mga Paalala", photographed
-- 2026-08-04, ../House Rules.jfif) -- 0007 left the list empty on purpose
-- rather than invent one, and this is the real thing.
--
-- Every rule starts marked for returning families too (returnee_too), since
-- the sheet does not say which ones a returning family may skip. Staff turn
-- off the ones a returnee need not be taken through again, topic by topic,
-- on the patient's Documents tab.
--
-- Only seeds a list nobody has started: if staff have already written their
-- own topics, this changes nothing.
-- Rollback: supabase/rollbacks/0055_down.sql.

insert into ops.orientation_topics (topic, sort_order, returnee_too)
select topic, ord, true
from (values
  ('Maligo agad ang lahat ng bata at magulang pagdating sa bahay.', 1),
  ('Patayin ang ilaw at electric fan kapag hindi ginagamit.', 2),
  ('Bawal magdala ng pagkain at kumain sa taas maliban kung hindi kayang bumaba ng pasyente.', 3),
  ('Bawal iwanan nang mag isa ang mga batang edad dose pababa.', 4),
  ('Bawal gumamit ng personal appliances sa loob ng bahay.', 5),
  ('Palaging linisin ang hinihigaan at ang banyo pagkatapos gamitin.', 6),
  ('Huwag pakalat-kalat ang mga personal na gamit.', 7),
  ('Igalang at respetuhin ang katahimikan ng ibang mga bata at magulang.', 8),
  ('Magdasal muna bago kumain.', 9),
  ('Bawal magluto ng sariling ulam. Kung hindi gusto ang nilutong pagkain, kailangang bumili sa labas.', 10),
  ('8:45 PM - magtitipon tipon sa activity area sa second floor para sa pagdarasal bago matulog.', 11),
  ('9:00 PM - patayin na ang mga ilaw. Ito ay oras ng pagtulog. Kung may kailangang kausapin sa telepono, lumabas muna ng kwarto.', 12),
  ('Bawal gamitin ang banyo sa baba.', 13),
  ('Bawal pumasok sa staff house.', 14),
  ('Dalhin ang lahat ng gamit kapag kayo ay uuwi na.', 15),
  ('Hinihikayat ang pagtulong sa paglinis ng bahay at sa pagluluto, ngunit ito ay boluntaryo lamang.', 16),
  ('Huwag ilagay sa dustpan ang tirang pagkain.', 17),
  ('Ilagay lahat ng basura sa trash bin.', 18),
  ('6:00 AM ang oras ng hatid at 5:00 PM naman ang oras ng sundo. Dapat ay nakahanda na dahil aalis ang service sa nasabing oras.', 19)
) as v(topic, ord)
where not exists (select 1 from ops.orientation_topics);

notify pgrst, 'reload schema';
