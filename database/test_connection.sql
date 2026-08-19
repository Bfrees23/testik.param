/*
  Minimal test — run in IBExpert Script Executive AFTER Connect.
  If step 1 fails, fix fbclient.dll or use install_schema.cmd instead of IBExpert.
*/

SELECT 1 AS OK FROM RDB$DATABASE;

CREATE SEQUENCE SEQ_TM07_TEST;

DROP SEQUENCE SEQ_TM07_TEST;
