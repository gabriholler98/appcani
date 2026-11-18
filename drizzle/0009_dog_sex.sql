ALTER TABLE dogs ADD COLUMN sex TEXT NOT NULL DEFAULT '' CHECK(sex IN ('','male','female'));
