/**
 * Дополнительные параметры карты 50: счётчик (0x082A…0x086C), комплекс (0x08D1…0x0928).
 * Финальный блок удалён — маски и очистки в основных параметрах.
 * Источник: RegisterMapFile_v50 / ModbusCommand.c.
 */
(function () {
    const G = {
        M: 'Параметры счётчика',
        K: 'Параметры комплекса',
    };

    const METER_STEPS = [
        {
            id: 100,
            reg: 0x082a,
            g: 'M',
            type: 'chr',
            regCount: 15,
            title: 'Наименование счётчика (Меню 2.1)(*)',
            hint: 'из типа комплекса ПК-ТМ-… / семейства счётчика',
            writeLkg: true,
        },
        { id: 101, reg: 0x0839, g: 'M', type: 'chr', regCount: 4, title: 'Типоразмер счётчика  (Меню 2.2)(*)', writeLkg: true },
        { id: 102, reg: 0x083d, g: 'M', type: 'chr', regCount: 8, title: 'Серийный номер счётчика  (Меню 2.3)(*)', hint: 'до 16 символов', writeLkg: true },
        { id: 103, reg: 0x0845, g: 'M', type: 'dt', regCount: 2, title: 'Дата поверки счётчика  (Меню 2.4)(*)', writeLkg: true },
        { id: 104, reg: 0x0847, g: 'M', type: 'dt', regCount: 2, title: 'Дата следующей поверки счётчика  (Меню 2.5)(*)', writeLkg: true },
        { id: 105, reg: 0x0849, g: 'M', type: 'w', regCount: 1, title: 'Диаметр условного прохода счётчика  (Меню 2.6)(*)', writeLkg: true },
        { id: 106, reg: 0x084a, g: 'M', type: 'f', regCount: 2, title: 'Цена импульса счётчика газа (число импульсов на 1 м3)  (Меню 2.7)', writeLkg: true },
        { id: 107, reg: 0x084c, g: 'M', type: 'd', regCount: 4, title: 'Накопленный объём счётчика  (Меню 2.8)', writeLkg: true },
        { id: 108, reg: 0x0850, g: 'M', type: 'f', regCount: 2, title: 'Порог чувствительности счётчика  (Меню 2.9) (Qstart) (Qstart < Q0 < Qmin.T ПЗQmin.T)', writeLkg: true },
        { id: 109, reg: 0x0852, g: 'M', type: 'f', regCount: 2, title: 'Минимальное значение диапазона измерений объемного расхода счётчика при рабочих условиях (Меню 2.10)(*)', writeLkg: true },
        { id: 110, reg: 0x0854, g: 'M', type: 'f', regCount: 2, title: 'Номинальное значение измерения объемного расхода счётчика при рабочих условиях (Меню 2.11)(*)', writeLkg: true },
        { id: 111, reg: 0x0856, g: 'M', type: 'f', regCount: 2, title: 'Максимальное значение диапазона измерений объемного расхода счётчика при рабочих условиях  (Меню 2.12)(*)', writeLkg: true },
        { id: 112, reg: 0x0858, g: 'M', type: 'f', regCount: 2, title: 'Переходное значение рабочего расхода счётчика Qt (Меню 2.13)(*)', unit: 'м³/ч', writeLkg: true },
        { id: 113, reg: 0x085a, g: 'M', type: 'f', regCount: 2, title: 'Потеря давления счётчика при максимальном расходе ΔPmax (Меню 2.14)(*)', unit: 'кПа', writeLkg: true },
        { id: 114, reg: 0x085c, g: 'M', type: 'f', regCount: 2, title: 'Максимальное избыточное давление в счётчике  (Меню 2.15) (*)', writeLkg: true },
        { id: 115, reg: 0x085e, g: 'M', type: 'f', regCount: 2, title: 'Минимальное значение температуры измеряемой среды счётчика  (Меню 2.16) (*)', writeLkg: true },
        { id: 116, reg: 0x0860, g: 'M', type: 'f', regCount: 2, title: 'Максимальное значение температуры измеряемой среды счётчика  (Меню 2.17) (*)', writeLkg: true },
        { id: 117, reg: 0x0862, g: 'M', type: 'f', regCount: 2, title: 'Минимальное значение температуры окружающей среды счётчика  (Меню 2.18) (*)', writeLkg: true },
        { id: 118, reg: 0x0864, g: 'M', type: 'f', regCount: 2, title: 'Максимальное значение температуры окружающей среды счётчика  (Меню 2.19) (*)', writeLkg: true },
        { id: 119, reg: 0x0866, g: 'M', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения объема газа при рабочих условиях в диапазоне от Qmin до Qt  (Меню 2.20) (*)', writeLkg: true },
        { id: 120, reg: 0x0868, g: 'M', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения объема газа при рабочих условиях в диапазоне от Qt до Qmax  (Меню 2.21) (*)', writeLkg: true },
        { id: 121, reg: 0x086a, g: 'M', type: 'u', regCount: 2, title: 'Максимальное значение счётного механизма счётчика  (Меню 2.22)', writeLkg: true },
        { id: 122, reg: 0x086c, g: 'M', type: 'w', regCount: 1, title: 'Направление счётчика (0-слева направо;1-справа налево;2-сверху вниз;3-снизу вверх)', writeLkg: true, u8: true },
    ];

    const COMPLEX_STEPS = [
        { id: 200, reg: 0x08d1, g: 'K', type: 'chr', regCount: 15, title: 'Наименование комплекса (Меню 3.01)(*)', writeLkg: true },
        { id: 201, reg: 0x08e0, g: 'K', type: 'q', regCount: 4, title: 'Серийный номер комплекса (Меню 3.02)(*)', writeLkg: true },
        { id: 202, reg: 0x08e4, g: 'K', type: 'dt', regCount: 2, title: 'Дата поверки комплекса (Меню 3.03)(*)', writeLkg: true },
        { id: 203, reg: 0x08e6, g: 'K', type: 'dt', regCount: 2, title: 'Дата следующей поверки комплекса (Меню 3.04)(*)', writeLkg: true },
        { id: 204, reg: 0x08e8, g: 'K', type: 'w', regCount: 1, title: 'Диаметр условного прохода комплекса; мм (Меню 3.05)(*)', writeLkg: true },
        { id: 205, reg: 0x08e9, g: 'K', type: 'f', regCount: 2, title: 'Порог чувствительности комплекса (Меню 3.06)(*)', writeLkg: true },
        { id: 206, reg: 0x08eb, g: 'K', type: 'f', regCount: 2, title: 'Минимальное значение диапазона измерений объемного расхода комплекса при рабочих условиях (Меню 3.07)(*)', writeLkg: true },
        { id: 207, reg: 0x08ed, g: 'K', type: 'f', regCount: 2, title: 'Номинальное значение измерения объемного расхода комплекса при рабочих условиях (Меню 3.08)(*)', writeLkg: true },
        { id: 208, reg: 0x08ef, g: 'K', type: 'f', regCount: 2, title: 'Максимальное значение диапазона измерений объемного расхода комплекса при рабочих условиях (Меню 3.09)(*)', writeLkg: true },
        { id: 209, reg: 0x08f1, g: 'K', type: 'f', regCount: 2, title: 'Переходное значение рабочего расхода комплекса (Меню 3.10)(*)', writeLkg: true },
        { id: 210, reg: 0x08f3, g: 'K', type: 'f', regCount: 2, title: 'Потеря давления комплекса при макисмальном расходе (Меню 3.11)(*)', writeLkg: true },
        { id: 211, reg: 0x08f5, g: 'K', type: 'f', regCount: 2, title: 'Минимальное значение диапазона измерений абсолютного давления газа комплекса (Меню 3.12)(*)', writeLkg: true },
        { id: 212, reg: 0x08f7, g: 'K', type: 'f', regCount: 2, title: 'Максимальное значение диапазона измерений абсолютного давления газа комплекса (Меню 3.13)(*)', writeLkg: true },
        { id: 213, reg: 0x08f9, g: 'K', type: 'f', regCount: 2, title: 'Минимальное значение диапазона измерений температуры газа комплекса (Меню 3.14)(*)', writeLkg: true },
        { id: 214, reg: 0x08fb, g: 'K', type: 'f', regCount: 2, title: 'Максимальное значение диапазона измерений температуры газа комплекса (Меню 3.15)(*)', writeLkg: true },
        { id: 215, reg: 0x08fd, g: 'K', type: 'f', regCount: 2, title: 'Минимальное значение диапазона измерений разности (перепада) давления комплекса (Меню 3.16)(*)', writeLkg: true },
        { id: 216, reg: 0x08ff, g: 'K', type: 'f', regCount: 2, title: 'Максимальное значение диапазона измерений разности (перепада) давления комплекса (Меню 3.17)(*)', writeLkg: true },
        { id: 217, reg: 0x0901, g: 'K', type: 'f', regCount: 2, title: 'Минимальное значение диапазона измерений температуры техн. парам. комплекса (Меню 3.18)(*)', writeLkg: true },
        { id: 218, reg: 0x0903, g: 'K', type: 'f', regCount: 2, title: 'Максимальное значение диапазона измерений температуры техн. парам. комплекса (Меню 3.19)(*)', writeLkg: true },
        { id: 219, reg: 0x0905, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения объема газа при рабочих условиях в диапазоне от Qmin до Qt (Меню 3.20)(*)', writeLkg: true },
        { id: 220, reg: 0x0907, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения объема газа при рабочих условиях в диапазоне от Qt до Qmax (Меню 3.21)(*)', writeLkg: true },
        { id: 221, reg: 0x0909, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения абсолютного давления газа комплекса (Меню 3.22)(*)', writeLkg: true },
        { id: 222, reg: 0x090b, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения температуры газа комплекса (Меню 3.23)(*)', writeLkg: true },
        { id: 223, reg: 0x090d, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой приведенной к верхнему пределу измерений погрешности измерения разности давлений комплекса (Меню 3.24)(*)', writeLkg: true },
        { id: 224, reg: 0x090f, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения температуры для контроля технологических параметров комплекса (Меню 3.25)(*)', writeLkg: true },
        { id: 225, reg: 0x0911, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения объема газа приведенного к стандартным условиям в диапазоне от Qmin до Qt (Меню 3.26)(*)', writeLkg: true },
        { id: 226, reg: 0x0913, g: 'K', type: 'f', regCount: 2, title: 'Пределы допускаемой относительной погрешности измерения объема газа приведенного к стандартным условиям в диапазоне от Qt до Qmax (Меню 3.27)(*)', writeLkg: true },
        { id: 227, reg: 0x0915, g: 'K', type: 'chr', regCount: 15, title: 'Наименование блока телеметрии (*)', writeLkg: true },
        { id: 228, reg: 0x0924, g: 'K', type: 'q', regCount: 4, title: 'Серийный номер блока телеметрии (*)', writeLkg: true },
        { id: 229, reg: 0x0928, g: 'K', type: 'w', regCount: 1, title: 'Направление комплекса (0-слева направо;1-справа налево;2-сверху вниз;3-снизу вверх)', writeLkg: true, u8: true },
    ];

    window.TM07_PARAMETRIZATION_EXTRA = {
        groups: { M: 'Параметры счётчика', K: 'Параметры комплекса' },
        sections: [
            {
                key: 'meter',
                title: 'Параметры счётчика',
                note: 'Регистры 0x082A…0x086C (меню 2.x, карта 50). Перед записью — ЛКГ и шаг 78 (0x06AB).',
                tbodyId: 'paramMeterTbody',
                filterId: 'paramMeterFilter',
                readAllId: 'paramMeterReadAll',
                writeAllId: 'paramMeterWriteAll',
                steps: METER_STEPS,
            },
            {
                key: 'complex',
                title: 'Параметры комплекса',
                note: 'Регистры 0x08D1…0x0928 (меню 3.x, карта 50). Перед записью — ЛКГ и шаг 78 (0x06AB).',
                tbodyId: 'paramComplexTbody',
                filterId: 'paramComplexFilter',
                readAllId: 'paramComplexReadAll',
                writeAllId: 'paramComplexWriteAll',
                steps: COMPLEX_STEPS,
            },
        ],
    };
})();
