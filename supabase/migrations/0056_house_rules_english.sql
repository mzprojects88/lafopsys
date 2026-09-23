-- 0056: an English translation beside each house rule. The Filipino text
-- stays the rule as the house posts it (0055); the translation is there for
-- anyone who reads English more easily, and for reports to donors and
-- auditors. Staff may edit or clear it; a topic without one shows only the
-- Filipino.
-- Rollback: supabase/rollbacks/0056_down.sql.

alter table ops.orientation_topics add column topic_en text;

update ops.orientation_topics t set topic_en = v.en
from (values
  ('Maligo agad%', 'Every child and parent bathes as soon as they arrive at the house.'),
  ('Patayin ang ilaw%', 'Turn off the lights and the electric fan when they are not in use.'),
  ('Bawal magdala ng pagkain%', 'Do not bring food upstairs or eat there, unless the patient cannot come down.'),
  ('Bawal iwanan%', 'Children twelve and under are never left on their own.'),
  ('Bawal gumamit ng personal appliances%', 'Personal appliances may not be used inside the house.'),
  ('Palaging linisin%', 'Always clean your bed and the bathroom after using them.'),
  ('Huwag pakalat%', 'Do not leave personal belongings lying around.'),
  ('Igalang at respetuhin%', 'Respect the quiet of the other children and parents.'),
  ('Magdasal muna%', 'Pray before eating.'),
  ('Bawal magluto%', 'Do not cook your own dish. If you do not want the food that was cooked, buy your own outside.'),
  ('8:45 PM%', '8:45 PM - everyone gathers at the activity area on the second floor for prayer before bed.'),
  ('9:00 PM%', '9:00 PM - lights out; this is sleeping time. If you need to take a call, step out of the room first.'),
  ('Bawal gamitin ang banyo%', 'The downstairs bathroom may not be used.'),
  ('Bawal pumasok%', 'Do not enter the staff house.'),
  ('Dalhin ang lahat%', 'Take all your belongings with you when you go home.'),
  ('Hinihikayat ang pagtulong%', 'Helping with the cleaning and the cooking is welcome, but it is voluntary.'),
  ('Huwag ilagay sa dustpan%', 'Do not put leftover food in the dustpan.'),
  ('Ilagay lahat ng basura%', 'Put all rubbish in the trash bin.'),
  ('6:00 AM ang oras%', 'The drop-off is at 6:00 AM and the pick-up at 5:00 PM. Be ready: the service leaves at those times.')
) as v(pattern, en)
where t.topic like v.pattern and t.topic_en is null;

notify pgrst, 'reload schema';
