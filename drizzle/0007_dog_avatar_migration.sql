-- Replace the four legacy emoji choices with one of the new profile thumbnails.
-- Uploaded dog photos are stored separately in dog_photos and are not affected.
UPDATE dogs
SET emoji = 'avatar:' || CASE abs(random()) % 25
  WHEN 0 THEN 'meticcio'
  WHEN 1 THEN 'labrador-retriever'
  WHEN 2 THEN 'golden-retriever'
  WHEN 3 THEN 'pastore-tedesco'
  WHEN 4 THEN 'chihuahua'
  WHEN 5 THEN 'barboncino'
  WHEN 6 THEN 'jack-russell-terrier'
  WHEN 7 THEN 'bulldog-francese'
  WHEN 8 THEN 'beagle'
  WHEN 9 THEN 'bassotto'
  WHEN 10 THEN 'maltese'
  WHEN 11 THEN 'border-collie'
  WHEN 12 THEN 'cocker-spaniel-inglese'
  WHEN 13 THEN 'yorkshire-terrier'
  WHEN 14 THEN 'cane-corso'
  WHEN 15 THEN 'pastore-australiano'
  WHEN 16 THEN 'carlino'
  WHEN 17 THEN 'shih-tzu'
  WHEN 18 THEN 'boxer'
  WHEN 19 THEN 'rottweiler'
  WHEN 20 THEN 'pinscher-nano'
  WHEN 21 THEN 'setter-inglese'
  WHEN 22 THEN 'volpino-italiano'
  WHEN 23 THEN 'lagotto-romagnolo'
  ELSE 'husky-siberiano'
END
WHERE emoji IN ('🐕','🐶','🐩','🦮');

UPDATE profiles
SET emoji = (
  SELECT emoji FROM dogs
  WHERE profile_id=profiles.id AND archived=0
  ORDER BY id!=profiles.id,name COLLATE NOCASE,id LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM dogs WHERE profile_id=profiles.id AND archived=0);

UPDATE walks
SET dogs_json = (
  SELECT json_group_array(json_set(entry.value,'$.emoji',COALESCE(
    (SELECT emoji FROM dogs WHERE id=json_extract(entry.value,'$.id')),
    json_extract(entry.value,'$.emoji')
  ))) FROM json_each(walks.dogs_json) entry
);

UPDATE join_requests
SET dogs_json = (
  SELECT json_group_array(json_set(entry.value,'$.emoji',COALESCE(
    (SELECT emoji FROM dogs WHERE id=json_extract(entry.value,'$.id')),
    json_extract(entry.value,'$.emoji')
  ))) FROM json_each(join_requests.dogs_json) entry
);
