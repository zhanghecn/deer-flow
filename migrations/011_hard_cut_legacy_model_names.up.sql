BEGIN;

UPDATE thread_bindings
SET model_name = 'kimi-k2.5'
WHERE model_name IN ('kimi-k2.5-1', 'kimi-k2.5-2');

UPDATE knowledge_build_jobs
SET model_name = 'kimi-k2.5'
WHERE model_name IN ('kimi-k2.5-1', 'kimi-k2.5-2');

DELETE FROM models
WHERE name IN ('kimi-k2.5-1', 'kimi-k2.5-2')
  AND EXISTS (
      SELECT 1
      FROM models canonical
      WHERE canonical.name = 'kimi-k2.5'
  );

UPDATE models
SET
    name = 'kimi-k2.5',
    display_name = 'Kimi K2.5'
WHERE name = 'kimi-k2.5-1'
  AND NOT EXISTS (
      SELECT 1
      FROM models canonical
      WHERE canonical.name = 'kimi-k2.5'
  );

UPDATE models
SET
    name = 'kimi-k2.5',
    display_name = 'Kimi K2.5'
WHERE name = 'kimi-k2.5-2'
  AND NOT EXISTS (
      SELECT 1
      FROM models canonical
      WHERE canonical.name = 'kimi-k2.5'
  );

DELETE FROM models
WHERE name IN ('kimi-k2.5-1', 'kimi-k2.5-2');

COMMIT;
