/*
  =====================================================================
  bpek_test.fdb — подготовка под ТМ-07 в существующих BPK / BPKEVENTS
  =====================================================================

  Уже есть (ничего создавать не нужно):
    BPKTYPEDICT
      ID=37  NAME=TM07    LEGALNAME=Корректор объема газа ТМ-07     PREFIX_NEW=300
      ID=38  NAME=PCTM07  LEGALNAME=Промышленный комплекс ТМ-07    PREFIX_NEW=400
      BOARDS_BITS=128 у обоих

  Карта:
    серийник 300…  →  BPK.TYPE = 37 (корректор)
    серийник 400…  →  BPK.TYPE = 38 (комплекс)

  Куда что писать:
    изделие          → BPK
    кто / когда / что → BPKEVENTS (+ USERID=SECUSER.ID, STANDID=STAND.STANDID)
    краткие детали   → BPKEVENTS.COMMENT  (VARCHAR ~1020, JSON ок)
    паспорт/протокол → BPKDOC (DOCTYPE 1=Паспорт, 2=Протокол поверки)

  IBExpert: Script Executive → Execute (F9) → Commit кнопкой.
  В скрипте нет COMMIT; (IBExpert ругается).

  Сейчас в словаре событий только БПЭК/СБИГ (ID 1..17).
  Ниже — новые типы «ТМ-07: …» (идемпотентно).
*/

/* ---------- 1) Типы событий ТМ-07 ---------- */

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: выдача серийного номера'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: выдача серийного номера'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: подтверждение сборки'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: подтверждение сборки'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: начало параметризации'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: начало параметризации'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: параметризация завершена'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: параметризация завершена'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: сверка после записи'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: сверка после записи'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: печать шильдика'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: печать шильдика'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: формирование паспорта'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: формирование паспорта'
);

INSERT INTO BPKEVENTTYPEDICT (ID, NAME)
SELECT GEN_ID(GEN_BPKEVENTTYPEDICT_ID, 1), 'ТМ-07: ошибка параметризации'
FROM RDB$DATABASE
WHERE NOT EXISTS (
  SELECT 1 FROM BPKEVENTTYPEDICT WHERE NAME = 'ТМ-07: ошибка параметризации'
);

/* ---------- 2) Проверка после Execute + Commit ---------- */

SELECT ID, NAME
FROM BPKEVENTTYPEDICT
WHERE NAME STARTING WITH 'ТМ-07:'
ORDER BY ID;

SELECT ID, NAME, LEGALNAME, PREFIX_NEW, BOARDS_BITS
FROM BPKTYPEDICT
WHERE ID IN (37, 38);

SELECT ID, NAME FROM BPKEVENTSTATEDICT ORDER BY ID;
/* 0 Годен | 1 Не годен | 2 Не определено | 3 НДС | 4 Ошибка | 5 Исправлено */

SELECT ID, NAME FROM REGISTERTABLE WHERE ID = 2;
/* TABLEID=2 → объект события = BPK */

SELECT ID, NAME FROM DOCTYPEDICT ORDER BY ID;
/* 1 Паспорт изделия | 2 Протокол поверки */


/*
  =====================================================================
  ПРИМЕРЫ ЗАПИСИ (подставь свои ID; не гоняй слепо на бою)
  =====================================================================

  Юзер:  SELECT ID, SAMACCOUNTNAME, FULLNAME, STANDID FROM SECUSER WHERE ENABLED = 1;
  Стенд: SELECT STANDID, COMMENT FROM STAND;

  -- A) Корректор (серийник 300…)
  INSERT INTO BPK (ID, SERIAL, TYPE, CURRENT_HW_VER, STATE_CURR_ID)
  VALUES (GEN_ID(GEN_BPK_ID, 1), '3002608005', 37, 128, 2);

  -- B) Комплекс (серийник 400…)
  INSERT INTO BPK (ID, SERIAL, TYPE, CURRENT_HW_VER, STATE_CURR_ID)
  VALUES (GEN_ID(GEN_BPK_ID, 1), '4002608001', 38, 128, 2);

  -- C) Событие «параметризация завершена»
  --    EVENTTYPEID = ID из SELECT выше («ТМ-07: параметризация завершена»)
  --    USERID / STANDID — реальные из SECUSER / STAND
  --    COMMENT ≤ ~1020 символов (краткий JSON, не полный дамп регистров)
  INSERT INTO BPKEVENTS (
    ID, EVENTTYPEID, EVENTDATE, EVENTSTATE,
    BPKID, USERID, STANDID, TABLEID, OBJECTID, COMMENT
  ) VALUES (
    GEN_ID(GEN_BPKEVENTS_ID, 1),
    :EVENTTYPEID,
    CURRENT_TIMESTAMP,
    0,
    :BPKID,
    :USERID,
    :STANDID,
    2,
    :BPKID,
    '{"order":"TM00-000712","scope":"corrector","template":"RVG G40","ok":85,"fail":0}'
  );

  -- D) Закрыть изделие на это событие
  UPDATE BPK
  SET LAST_EVENT_ID = :EVENTID,
      STATE_CURR_ID = 0
  WHERE ID = :BPKID;

  -- E) Паспорт (опционально)
  INSERT INTO BPKDOC (ID, DOCTYPEID, BPKID, DOCDATE, USERID)
  VALUES (GEN_ID(GEN_BPKDOC_ID, 1), 1, :BPKID, CURRENT_TIMESTAMP, :USERID);

  Полный снимок регистров в COMMENT не влезает — либо краткий JSON,
  либо позже отдельная таблица рядом с BPK (когда скажешь).
*/
