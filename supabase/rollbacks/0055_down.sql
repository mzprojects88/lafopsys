-- Undo 0055: removes the seeded house rules, but never a topic a stay has
-- already been ticked against (that history stays).
delete from ops.orientation_topics t
where t.sort_order between 1 and 19
  and t.topic like any (array['Maligo agad%', 'Patayin ang ilaw%', 'Bawal magdala%', 'Bawal iwanan%', 'Bawal gumamit%',
                              'Palaging linisin%', 'Huwag pakalat%', 'Igalang at respetuhin%', 'Magdasal muna%',
                              'Bawal magluto%', '8:45 PM%', '9:00 PM%', 'Bawal gamitin ang banyo%', 'Bawal pumasok%',
                              'Dalhin ang lahat%', 'Hinihikayat ang pagtulong%', 'Huwag ilagay sa dustpan%',
                              'Ilagay lahat ng basura%', '6:00 AM ang oras%'])
  and not exists (select 1 from ops.stay_orientation_checks c where c.topic_id = t.id);
