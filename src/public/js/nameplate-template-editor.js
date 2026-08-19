(function () {
'use strict';
const T = {"spec1": "\u0421\u0442\u0440\u043e\u043a\u0430 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438 1", "spec2": "\u0421\u0442\u0440\u043e\u043a\u0430 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438 2", "spec3": "\u0421\u0442\u0440\u043e\u043a\u0430 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438 3", "release": "\u0412\u044b\u043f\u0443\u0441\u043a", "serial": "\u0421\u0435\u0440\u0438\u0439\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440", "qr": "QR-\u043a\u043e\u0434", "text": "\u0422\u0435\u043a\u0441\u0442", "qrtype": "QR / DataMatrix", "logo": "\u041b\u043e\u0433\u043e\u0442\u0438\u043f \u0422\u0435\u0445\u043d\u043e\u043c\u0435\u0440", "title": "\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a (\u0438\u0437 .btw)", "border": "\u0420\u0430\u043c\u043a\u0430 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0438", "static": "\u0441\u0442\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439", "selectObj": "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043e\u0431\u044a\u0435\u043a\u0442 \u043d\u0430 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0435 \u0438\u043b\u0438 \u0432 \u0441\u043f\u0438\u0441\u043a\u0435 \u0441\u043b\u0435\u0432\u0430", "pos": "\u041f\u043e\u0437\u0438\u0446\u0438\u044f", "font": "\u0428\u0440\u0438\u0444\u0442", "data": "\u0414\u0430\u043d\u043d\u044b\u0435", "posMm": "\u041f\u043e\u0437\u0438\u0446\u0438\u044f (\u043c\u043c)", "qrSize": "\u0420\u0430\u0437\u043c\u0435\u0440 QR", "sideMm": "\u0421\u0442\u043e\u0440\u043e\u043d\u0430 (\u043c\u043c)", "rot": "\u041f\u043e\u0432\u043e\u0440\u043e\u0442", "angle": "\u0423\u0433\u043e\u043b", "h0": "0\u00b0 \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u043e", "h90": "90\u00b0 \u043f\u043e \u0447\u0430\u0441\u043e\u0432\u043e\u0439", "h270": "90\u00b0 \u043f\u0440\u043e\u0442\u0438\u0432 \u0447\u0430\u0441\u043e\u0432\u043e\u0439", "sizePt": "\u0420\u0430\u0437\u043c\u0435\u0440 (pt)", "fontMmLabel": "\u0412\u044b\u0441\u043e\u0442\u0430 \u0448\u0440\u0438\u0444\u0442\u0430 (\u043c\u043c)", "bold": "\u0416\u0438\u0440\u043d\u044b\u0439", "align": "\u0412\u044b\u0440\u0430\u0432\u043d\u0438\u0432\u0430\u043d\u0438\u0435", "alignL": "\u041f\u043e \u043b\u0435\u0432\u043e\u043c\u0443 \u043a\u0440\u0430\u044e", "alignC": "\u041f\u043e \u0446\u0435\u043d\u0442\u0440\u0443", "src": "\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a \u0434\u0430\u043d\u043d\u044b\u0445", "btField": "\u041f\u043e\u043b\u0435 BarTender: ", "cxMm": "X \u0446\u0435\u043d\u0442\u0440 (\u043c\u043c)", "yMm": "Y (\u043c\u043c)", "wMm": "\u0428\u0438\u0440\u0438\u043d\u0430 (\u043c\u043c)", "hMm": "\u0412\u044b\u0441\u043e\u0442\u0430 (\u043c\u043c)", "xMm": "X (\u043c\u043c)", "badJson": "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 JSON", "load": "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0448\u0430\u0431\u043b\u043e\u043d\u0430\u2026", "loadErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438", "loaded": "\u0428\u0430\u0431\u043b\u043e\u043d \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d. \u041f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u0439\u0442\u0435 \u043e\u0431\u044a\u0435\u043a\u0442\u044b \u043a\u0430\u043a \u0432 BarTender.", "save": "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435\u2026", "saveErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f", "saved": "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e: ", "imp": "\u0418\u043c\u043f\u043e\u0440\u0442 \u0438\u0437 ", "impErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u0438\u043c\u043f\u043e\u0440\u0442\u0430", "impOk": "\u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u0438\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u044b \u0438\u0437 ", "reset": "\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043e\u0442\u043c\u0435\u043d\u0435\u043d\u044b", "genPdf": "\u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f PDF\u2026", "prevErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0435\u0432\u044c\u044e", "prevOk": "\u041f\u0440\u0435\u0432\u044c\u044e \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e", "order": "\u0422\u041c00-000001", "product": "\u041a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440 \u043e\u0431\u044a\u0451\u043c\u0430 \u0433\u0430\u0437\u0430 \u0422\u041c-07", "relSample": "\u0412\u044b\u043f\u0443\u0441\u043a ", "s1": "(\u04184;\u2026", "s2": "\u041f\u0422\u0413(\u2026", "s3": "\u041f\u041f\u0414(\u2026", "relDef": "\u0412\u044b\u043f\u0443\u0441\u043a 01.2026", "addText": "\u0422\u0435\u043a\u0441\u0442", "addQr": "QR-\u043a\u043e\u0434", "del": "\u0423\u0434\u0430\u043b\u0438\u0442\u044c", "dup": "\u0414\u0443\u0431\u043b\u0438\u0440\u043e\u0432\u0430\u0442\u044c", "copy": "\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c", "paste": "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c", "lock": "\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c", "unlock": "\u0420\u0430\u0437\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c", "hide": "\u0421\u043a\u0440\u044b\u0442\u044c", "show": "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c", "bringFwd": "\u0412\u043f\u0435\u0440\u0451\u0434", "sendBack": "\u041d\u0430\u0437\u0430\u0434", "alignLeft": "\u0412\u043b\u0435\u0432\u043e", "alignCenter": "\u041f\u043e \u0446\u0435\u043d\u0442\u0440\u0443", "alignRight": "\u0412\u043f\u0440\u0430\u0432\u043e", "alignTop": "\u0412\u0432\u0435\u0440\u0445", "alignMiddle": "\u041f\u043e \u0441\u0435\u0440\u0435\u0434\u0438\u043d\u0435", "alignBottom": "\u0412\u043d\u0438\u0437", "name": "\u0418\u043c\u044f", "visible": "\u0412\u0438\u0434\u0438\u043c\u044b\u0439", "locked": "\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d", "customText": "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u0441\u043a\u0438\u0439 \u0442\u0435\u043a\u0441\u0442", "undo": "\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c", "redo": "\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c", "deleted": "\u041e\u0431\u044a\u0435\u043a\u0442 \u0443\u0434\u0430\u043b\u0451\u043d", "added": "\u041e\u0431\u044a\u0435\u043a\u0442 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d", "cannotDel": "\u042d\u0442\u043e\u0442 \u043e\u0431\u044a\u0435\u043a\u0442 \u043d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c", "clipboardEmpty": "\u0411\u0443\u0444\u0435\u0440 \u043f\u0443\u0441\u0442", "toolbox": "\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b", "layers": "\u0421\u043b\u043e\u0438", "mm": "\u043c\u043c", "newText": "\u0422\u0435\u043a\u0441\u0442", "resetZero": "\u0421\u0431\u0440\u043e\u0441 \u0434\u043e \u043d\u0443\u043b\u044f\u2026", "resetZeroOk": "\u0428\u0430\u0431\u043b\u043e\u043d \u0441\u0431\u0440\u043e\u0448\u0435\u043d \u043a \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u0430\u043c \u0438\u0437 ", "resetZeroErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0431\u0440\u043e\u0441\u0430", "resetZeroConfirm": "\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u0432\u0441\u0435 \u043e\u0431\u044a\u0435\u043a\u0442\u044b \u043a \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u0430\u043c \u0438\u0437 {btw}?\n\n\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u0441\u043a\u0438\u0435 \u043e\u0431\u044a\u0435\u043a\u0442\u044b \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u044b. \u041d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u043f\u0430\u0434\u0443\u0442.", "clearAll": "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0432\u0441\u0435\u0445 \u043e\u0431\u044a\u0435\u043a\u0442\u043e\u0432\u2026", "clearAllOk": "\u0412\u0441\u0435 \u043e\u0431\u044a\u0435\u043a\u0442\u044b \u0443\u0434\u0430\u043b\u0435\u043d\u044b \u0441 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0438", "clearAllErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0447\u0438\u0441\u0442\u043a\u0438", "clearAllConfirm": "\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0432\u0441\u0435 \u043e\u0431\u044a\u0435\u043a\u0442\u044b \u0441 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0438?\n\n\u041e\u0441\u0442\u0430\u043d\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0444\u043e\u043d .btw (\u043b\u043e\u0433\u043e\u0442\u0438\u043f, \u0440\u0430\u043c\u043a\u0430). \u041d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u043f\u0430\u0434\u0443\u0442.", "clearSamples": "\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u043f\u043e\u043b\u044f \u043f\u0440\u0435\u0432\u044c\u044e", "newTemplate": "\u041d\u043e\u0432\u044b\u0439 \u0448\u0430\u0431\u043b\u043e\u043d", "newTemplateCreate": "\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430\u2026", "newTemplateOk": "\u0421\u043e\u0437\u0434\u0430\u043d \u0448\u0430\u0431\u043b\u043e\u043d: ", "newTemplateErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0448\u0430\u0431\u043b\u043e\u043d\u0430", "newTemplateNameRequired": "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430", "templateLabel": "\u0428\u0430\u0431\u043b\u043e\u043d", "switchTemplate": "\u041f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430\u2026", "unsavedSwitch": "\u0415\u0441\u0442\u044c \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f. \u041f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0448\u0430\u0431\u043b\u043e\u043d \u0431\u0435\u0437 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f?", "labelSetup": "\u041c\u0430\u043a\u0435\u0442 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0438", "pageSize": "\u0420\u0430\u0437\u043c\u0435\u0440 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b", "pageW": "\u0428\u0438\u0440\u0438\u043d\u0430 (\u043c\u043c)", "pageH": "\u0412\u044b\u0441\u043e\u0442\u0430 (\u043c\u043c)", "margins": "\u041f\u043e\u043b\u044f (\u043e\u0442\u0441\u0442\u0443\u043f\u044b)", "marginTop": "\u0421\u0432\u0435\u0440\u0445\u0443", "marginRight": "\u0421\u043f\u0440\u0430\u0432\u0430", "marginBottom": "\u0421\u043d\u0438\u0437\u0443", "marginLeft": "\u0421\u043b\u0435\u0432\u0430", "marginAll": "\u041e\u0434\u0438\u043d\u0430\u043a\u043e\u0432\u044b\u0435 \u0441\u043e \u0432\u0441\u0435\u0445 \u0441\u0442\u043e\u0440\u043e\u043d", "gridStep": "\u0428\u0430\u0433 \u0441\u0435\u0442\u043a\u0438 (\u043c\u043c)", "showMargins": "\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u043f\u043e\u043b\u044f", "snapMargins": "\u041f\u0440\u0438\u0432\u044f\u0437\u043a\u0430 \u043a \u043f\u043e\u043b\u044f\u043c", "layoutHint": "\u041a\u043b\u0438\u043a\u043d\u0438\u0442\u0435 \u043f\u043e \u043f\u0443\u0441\u0442\u043e\u043c\u0443 \u043c\u0435\u0441\u0442\u0443 \u043d\u0430 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0435 \u0438\u043b\u0438 \u043a\u043d\u043e\u043f\u043a\u0443 \u00ab\u041c\u0430\u043a\u0435\u0442\u00bb, \u0447\u0442\u043e\u0431\u044b \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0440\u0430\u0437\u043c\u0435\u0440 \u0438 \u043e\u0442\u0441\u0442\u0443\u043f\u044b.", "fixedText": "\u0421\u0442\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0442\u0435\u043a\u0441\u0442", "fixedTextHint": "\u0422\u0435\u043a\u0441\u0442 \u043e\u0431\u044a\u0435\u043a\u0442\u0430 (\u043d\u0435 \u0438\u0437 \u0411\u0414). \u041c\u043e\u0436\u043d\u043e \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0447\u0435\u0440\u0435\u0437 Ctrl+V \u043d\u0430 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0435.", "pasteExtOk": "\u0422\u0435\u043a\u0441\u0442 \u0432\u0441\u0442\u0430\u0432\u043b\u0435\u043d \u0441 \u0431\u0443\u0444\u0435\u0440\u0430 \u043e\u0431\u043c\u0435\u043d\u0430", "pasteExtEmpty": "\u0411\u0443\u0444\u0435\u0440 \u043e\u0431\u043c\u0435\u043d\u0430 \u043f\u0443\u0441\u0442", "pasteExtNeedFocus": "\u041a\u043b\u0438\u043a\u043d\u0438\u0442\u0435 \u043f\u043e \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0435 \u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 Ctrl+V", "image": "PNG / \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435", "pasteImgOk": "PNG \u0432\u0441\u0442\u0430\u0432\u043b\u0435\u043d \u0441 \u0431\u0443\u0444\u0435\u0440\u0430 \u043e\u0431\u043c\u0435\u043d\u0430", "pasteImgErr": "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435", "imageSize": "\u0420\u0430\u0437\u043c\u0435\u0440 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f", "deleteTemplate": "\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0448\u0430\u0431\u043b\u043e\u043d", "deleteTemplateConfirm": "\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0448\u0430\u0431\u043b\u043e\u043d \u00ab{name}\u00bb?\n\n\u0424\u0430\u0439\u043b \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0451\u043d \u0431\u0435\u0437 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u0438 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f.", "deleteTemplateOk": "\u0428\u0430\u0431\u043b\u043e\u043d \u0443\u0434\u0430\u043b\u0451\u043d: ", "deleteTemplateErr": "\u041e\u0448\u0438\u0431\u043a\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u0448\u0430\u0431\u043b\u043e\u043d\u0430", "deleteTemplateProtected": "\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 \u0448\u0430\u0431\u043b\u043e\u043d \u043d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c", "deleteTemplateBusy": "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430\u2026"
,"applyRef":"\u041f\u0440\u0438\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u0440\u0430\u0437\u043c\u0435\u0440\u043e\u0432 \u0447\u0435\u0440\u0442\u0451\u0436\u0430 \u0422\u041c\u0420.754463.091\u2026","applyRefOk":"\u0421\u0431\u043e\u0440\u043d\u044b\u0439 \u0448\u0430\u0431\u043b\u043e\u043d \u043f\u043e \u0447\u0435\u0440\u0442\u0435\u0436\u0443 58\u00d720 \u043c\u043c","applyRefConfirm":"\u0417\u0430\u043c\u0435\u043d\u0438\u0442\u044c \u043e\u0431\u044a\u0435\u043a\u0442\u044b \u043d\u0430 \u0440\u0430\u0437\u043c\u0435\u0440\u044b \u0438\u0437 \u0447\u0435\u0440\u0442\u0451\u0436\u0430 \u0422\u041c\u0420.754463.091?\n\n\u0424\u043e\u043d .btw \u043d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u0432 \u043c\u043c.","printLabel":"\u041f\u0435\u0447\u0430\u0442\u044c\u2026","printOk":"\u0428\u0438\u043b\u044c\u0434 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u043d\u0430 \u043f\u0440\u0438\u043d\u0442\u0435\u0440 ","printErr":"\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0435\u0447\u0430\u0442\u0438","badSerial":"\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0441\u0435\u0440\u0438\u0439\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440 (10 \u0446\u0438\u0444\u0440)","agentOff":"\u0410\u0433\u0435\u043d\u0442 \u043f\u0435\u0447\u0430\u0442\u0438 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u2014 \u043e\u0442\u043a\u0440\u044b\u0442 PDF-\u043f\u0440\u0435\u0432\u044c\u044e","overlayErr":"\u042d\u0442\u0430\u043b\u043e\u043d\u043d\u044b\u0439 PNG \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d","barcodeType":"\u0422\u0438\u043f \u043a\u043e\u0434\u0430","barcodeQr":"QR","barcodeDm":"DataMatrix","productComplex":"\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0422\u041c-07","exportJson":"\u042d\u043a\u0441\u043f\u043e\u0440\u0442 JSON","exportJsonOk":"JSON \u0441\u043a\u0430\u0447\u0430\u043d","downloadPdf":"\u0421\u043a\u0430\u0447\u0430\u0442\u044c PDF","downloadPdfOk":"PDF \u0441\u043a\u0430\u0447\u0430\u043d","downloadPdfNeed":"\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u043f\u0440\u0435\u0432\u044c\u044e PDF","draftRestored":"\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a","draftCleared":"\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u043e\u0447\u0438\u0449\u0435\u043d","importJson":"\u0418\u043c\u043f\u043e\u0440\u0442 JSON","importJsonOk":"JSON \u0438\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d","importJsonErr":"\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c JSON","importJsonConfirm":"\u0417\u0430\u043c\u0435\u043d\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u0438\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u043c JSON?","multiSelected":"\u0412\u044b\u0431\u0440\u0430\u043d\u043e \u043e\u0431\u044a\u0435\u043a\u0442\u043e\u0432: ","ctxProps":"\u0421\u0432\u043e\u0439\u0441\u0442\u0432\u0430","selectAll":"\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0432\u0441\u0435","deletedN":"\u0423\u0434\u0430\u043b\u0435\u043d\u043e: ","distNeed":"\u041d\u0443\u0436\u043d\u043e \u043d\u0435 \u043c\u0435\u043d\u0435\u0435 3 \u043e\u0431\u044a\u0435\u043a\u0442\u043e\u0432","distOk":"\u0420\u0430\u0441\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u043e","matchNeed":"\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u043e\u0431\u044a\u0435\u043a\u0442\u043e\u0432","matchOk":"\u0420\u0430\u0437\u043c\u0435\u0440 \u043f\u0440\u0438\u043c\u0435\u043d\u0451\u043d","styleCopied":"\u0421\u0442\u0438\u043b\u044c \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d","stylePasted":"\u0421\u0442\u0438\u043b\u044c \u0432\u0441\u0442\u0430\u0432\u043b\u0435\u043d","styleEmpty":"\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439\u0442\u0435 \u0441\u0442\u0438\u043b\u044c","guidePinned":"\u041d\u0430\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u0449\u0430\u044f \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0430","guidesCleared":"\u041d\u0430\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u0449\u0438\u0435 \u043e\u0447\u0438\u0449\u0435\u043d\u044b","fitTextOk":"\u0428\u0438\u0440\u0438\u043d\u0430 \u043f\u043e\u0434 \u0442\u0435\u043a\u0441\u0442","centerLabel":"\u041f\u043e \u0446\u0435\u043d\u0442\u0440\u0443 \u044d\u0442\u0438\u043a\u0435\u0442\u043a\u0438","sameW":"\u041e\u0434\u0438\u043d\u0430\u043a\u043e\u0432\u0430\u044f \u0448\u0438\u0440\u0438\u043d\u0430","sameH":"\u041e\u0434\u0438\u043d\u0430\u043a\u043e\u0432\u0430\u044f \u0432\u044b\u0441\u043e\u0442\u0430","renamePrompt":"\u0418\u043c\u044f \u043e\u0431\u044a\u0435\u043a\u0442\u0430","agentOnline":"\u0410\u0433\u0435\u043d\u0442 \u043f\u0435\u0447\u0430\u0442\u0438 \u043e\u043d\u043b\u0430\u0439\u043d","agentOffline":"\u0410\u0433\u0435\u043d\u0442 \u043f\u0435\u0447\u0430\u0442\u0438 \u043e\u0444\u0444\u043b\u0430\u0439\u043d","barcodeC128":"Code128","addLine":"\u041b\u0438\u043d\u0438\u044f","addBox":"\u041f\u0440\u044f\u043c\u043e\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a","addImage":"\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430","calibSaved":"\u041a\u0430\u043b\u0438\u0431\u0440\u043e\u0432\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430","calibErr":"\u041e\u0448\u0438\u0431\u043a\u0430 \u043a\u0430\u043b\u0438\u0431\u0440\u043e\u0432\u043a\u0438","batchEmpty":"\u041d\u0435\u0442 \u0432\u0430\u043b\u0438\u0434\u043d\u044b\u0445 S/N","batchProgress":"\u041f\u0430\u043a\u0435\u0442","batchDone":"\u041f\u0430\u043a\u0435\u0442 \u043d\u0430\u043f\u0435\u0447\u0430\u0442\u0430\u043d","batchAbort":"\u041f\u0430\u043a\u0435\u0442 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d","batchFail":"\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0430\u043a\u0435\u0442\u0430 \u043d\u0430 ","renameOk":"\u041f\u0435\u0440\u0435\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u043e","dupTplOk":"\u0428\u0430\u0431\u043b\u043e\u043d \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d","emptyAsk":"\u0428\u0430\u0431\u043b\u043e\u043d \u043f\u0443\u0441\u0442. \u0417\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u043f\u043e \u0447\u0435\u0440\u0442\u0435\u0436\u0443?","validateFail":"\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u0430","groupOk":"\u0421\u0433\u0440\u0443\u043f\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u043e","ungroupOk":"\u0420\u0430\u0437\u0433\u0440\u0443\u043f\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u043e","pngOk":"PNG \u0441\u043a\u0430\u0447\u0430\u043d","rangeBad":"\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d S/N"};
const API = '/api/nameplate-template.php';
const ICONS = { text:'bi-fonts', qr:'bi-qr-code', serial:'bi-upc-scan', static:'bi-image', image:'bi-image', line:'bi-slash-lg', box:'bi-square' };
const state = {
  kind:'corrector', templateId:'corrector', templates:[], document:null, savedDocument:null, selectedId:null, selectedIds:[], zoom:1, previewUrl:null,
  drag:null, propsTab:'position', dataSources:[], staticObjects:[], clipboard:null,
  history:[], historyIndex:-1, maxHistory:80, suppressHistory:false,
  overlayLoaded:false, overlayUrl:null, previewTimer:null, previewAbort:null, guideSnapPx:null,
  nudgeTimer:null, cursorMm:{x:null,y:null}, layerDragId:null, draftTimer:null,
  spaceDown:false, pan:null, marquee:null, layerFilter:'', hoverId:null, styleClipboard:null, pinnedGuides:[], statusTimer:null, agentOk:null,
  batchAbort:false, batchRunning:false, printOverrides:null,
  thermalMode:false, sideBySide:false, previewPngUrl:null,
};
const $ = id => document.getElementById(id);
const els = {
  status:$('btStatus'), templateSelect:$('btTemplateSelect'), templateInfo:$('btTemplateInfo'), objList:$('btObjList'), props:$('btProps'),
  labelStage:$('btLabelStage'), labelOuter:$('btLabelOuter'), labelBg:$('btLabelBg'), labelOverlay:$('btLabelOverlay'), objects:$('btObjects'),
  grid:$('btGrid'), guides:$('btGuides'), canvasScroll:$('btCanvasScroll'), rulerH:$('btRulerH'), rulerV:$('btRulerV'),
  rulerHairV:$('btRulerHairV'), rulerHairH:$('btRulerHairH'), crosshairV:$('btCrosshairV'), crosshairH:$('btCrosshairH'), importJsonFile:$('btImportJsonFile'), ctxMenu:$('btCtxMenu'), marquee:$('btMarquee'), layerSearch:$('btLayerSearch'), pinnedGuides:$('btPinnedGuides'), selCount:$('btSelCount'), agentStatus:$('btAgentStatus'),
  previewFrame:$('btPreviewFrame'), previewBusy:$('btPreviewBusy'), sampleSerial:$('btSampleSerial'), sampleConfig:$('btSampleConfig'),
  sampleRelease:$('btSampleRelease'), sampleTitle:$('btSampleTitle'), zoomLabel:$('btZoomLabel'), cursorX:$('btCursorX'), cursorY:$('btCursorY'),
  selName:$('btSelName'), selSize:$('btSelSize'), statusZoom:$('btStatusZoom'),
  dirtyBadge:$('btDirtyBadge'), dirtyStatus:$('btDirtyStatus'), saveBtn:$('btSave'),
  showGrid:$('btShowGrid'), snap:$('btSnap'), showBg:$('btShowBg'),
  showOverlay:$('btShowOverlay'), overlayOpacity:$('btOverlayOpacity'),
  newName:$('btNewName'), newSlug:$('btNewSlug'), newWidth:$('btNewWidth'), newHeight:$('btNewHeight'),
  newMode:$('btNewMode'), newBtw:$('btNewBtw'), newModalEl:$('btNewTemplateModal'),
  deleteTemplateBtn:$('btDeleteTemplate'),
  propsHead:$('btPropsHead'), marginGuide:$('btMarginGuide'), showMargins:$('btShowMargins'),
  app:$('btApp'), panelLeft:$('btPanelLeft'), panelRight:$('btPanelRight'),
  collapseLeft:$('btCollapseLeft'), collapseRight:$('btCollapseRight'),
  restoreLeft:$('btRestoreLeft'), restoreRight:$('btRestoreRight'),
  workspaceSize:$('btWorkspaceSize'), pageSizeBadge:$('btPageSizeBadge'),
  addImageFile:$('btAddImageFile'), batchSerials:$('btBatchSerials'), batchPrint:$('btBatchPrint'), batchStop:$('btBatchStop'),
  calibDensity:$('btCalibDensity'), calibSpeed:$('btCalibSpeed'), calibYOffset:$('btCalibYOffset'), calibThreshold:$('btCalibThreshold'),
  calibDensityVal:$('btCalibDensityVal'), calibSpeedVal:$('btCalibSpeedVal'), calibYOffsetVal:$('btCalibYOffsetVal'), calibThresholdVal:$('btCalibThresholdVal'),
  calibSave:$('btCalibSave'), calibTest:$('btCalibTest'),
  templateGallery:$('btTemplateGallery'), renameTemplateBtn:$('btRenameTemplate'), duplicateTemplateBtn:$('btDuplicateTemplate'),
  emptyBanner:$('btEmptyTemplateBanner'), fillReferenceBtn:$('btFillReference'), fieldsPanel:$('btFieldsPanel'),
  thermalPreview:$('btThermalPreview'), sideBySide:$('btSideBySide'), previewThermal:$('btPreviewThermal'), previewRef:$('btPreviewRef'), previewSplit:$('btPreviewSplit'),
  downloadPngBtn:$('btDownloadPngBtn'), batchRange:$('btBatchRange'), batchExpand:$('btBatchExpand'),
};

function setStatus(text, kind) {
  if (state.statusTimer) { clearTimeout(state.statusTimer); state.statusTimer = null; }
  if (!text) { els.status.classList.add('d-none'); return; }
  els.status.textContent=text;
  els.status.className='alert py-2 small mb-2 alert-'+(kind||'secondary');
  if (kind === 'success' || kind === 'secondary' || kind === 'info') {
    state.statusTimer = setTimeout(() => {
      if (els.status.textContent === text) els.status.classList.add('d-none');
      state.statusTimer = null;
    }, 3200);
  }
}
async function fetchJson(url, options) {
  const res = await fetch(url, Object.assign({credentials:'same-origin'}, options||{}));
  const data = await res.json().catch(() => ({ok:false, error:T.badJson}));
  if (!res.ok && data.ok !== false) { data.ok=false; data.error=data.error||('HTTP '+res.status); }
  return {res, data};
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function num(v, fb) { const n=Number(v); return Number.isFinite(n)?n:fb; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function docRefW() { return num(state.document?.refW,1052); }
function docRefH() { return num(state.document?.refH,364); }
function docPageW() { return num(state.document?.pageWidthMm,58); }
function docPageH() { return num(state.document?.pageHeightMm,20); }
function pxToMmX(px) { return (px/docRefW())*docPageW(); }
function pxToMmY(px) { return (px/docRefH())*docPageH(); }
function mmToPxX(mm) { return (mm/docPageW())*docRefW(); }
function mmToPxY(mm) { return (mm/docPageH())*docRefH(); }
function fontPx(fontPt) { return Math.max(8, fontPt*0.352778*(docRefH()/docPageH())); }
const FONT_MM_ASCENDER_RATIO = 0.80;
function fontFamilyForObj(obj) {
  if (obj && (obj.mono || obj.id === 'serial')) return "'DejaVu Sans Mono', Consolas, monospace";
  return "'DejaVu Sans', Arial, Helvetica, sans-serif";
}
function fontPxForObj(obj) {
  const mm = num(obj?.fontMm, 0);
  if (mm > 0) {
    const targetCap = (mm / docPageH()) * docRefH();
    return Math.max(8, targetCap / FONT_MM_ASCENDER_RATIO);
  }
  return fontPx(num(obj?.fontPt, 4.2));
}
function fontMmFromPt(pt) { return Math.round((num(pt, 4.2) * 0.352778) * 100) / 100; }
function fontPtFromMm(mm) { return Math.round((num(mm, 2.5) / 0.352778) * 10) / 10; }
function lineHeightPx(obj) { return Math.max(12, fontPxForObj(obj)); }
function measureTextWidthPx(text, fontPxSize, obj) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) return text.length * fontPxSize * 0.55;
  const weight = obj && obj.bold ? '700' : '400';
  ctx.font = weight + ' ' + fontPxSize + 'px ' + fontFamilyForObj(obj);
  return ctx.measureText(String(text || '')).width;
}
function fitFontPxToWidth(text, fontPxSize, maxW, obj) {
  if (!text || !(maxW > 8)) return fontPxSize;
  let px = fontPxSize;
  const shrink = (pad) => {
    let lo = 8, hi = px;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const w = measureTextWidthPx(text, mid, obj);
      if (w <= maxW - pad) lo = mid; else hi = mid;
    }
    return Math.max(8, lo);
  };
  px = shrink(Math.max(2, px * 0.08));
  if (px < 48) px = shrink(Math.max(2, px * 0.09));
  return px;
}
function editorObjects() { return state.document?.editorObjects || []; }
function getObject(id) { return editorObjects().find(o=>o.id===id) || null; }
function nextZ() { return Math.max(0,...editorObjects().map(o=>num(o.zIndex,0)))+10; }
function newId(prefix) { return prefix+'_'+Math.random().toString(36).slice(2,9); }

function defaultLayoutSettings() {
  return { marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, gridStepMm:1, showMarginGuides:true, snapToMargins:false };
}
function ensureLayoutSettings() {
  if (!state.document) return defaultLayoutSettings();
  const d = defaultLayoutSettings();
  const raw = state.document.layoutSettings;
  if (raw && typeof raw === 'object') Object.keys(d).forEach(k => { if (raw[k] != null) d[k] = raw[k]; });
  state.document.layoutSettings = d;
  return d;
}
function layoutSettings() { return ensureLayoutSettings(); }
function syncMarginCheckbox() {
  if (!els.showMargins) return;
  els.showMargins.checked = !!layoutSettings().showMarginGuides;
}
function updatePageDimensions(wMm, hMm) {
  wMm = Math.max(10, Math.min(300, Number(wMm) || docPageW()));
  hMm = Math.max(5, Math.min(300, Number(hMm) || docPageH()));
  state.document.pageWidthMm = wMm;
  state.document.pageHeightMm = hMm;
  state.document.refW = Math.max(100, Math.round(wMm * (1052 / 58)));
  state.document.refH = Math.max(100, Math.round(hMm * (364 / 20)));
  updatePageSizeBadges();
}
function snapMm(mm, axis) {
  if (!els.snap.checked) return mm;
  const step = Math.max(0.1, Number(layoutSettings().gridStepMm) || 1);
  let best = Math.round(mm / step) * step;
  let bestDist = Math.abs(mm - best);
  if (layoutSettings().snapToMargins) {
    const L = layoutSettings();
    const edges = axis === 'x'
      ? [L.marginLeftMm, docPageW() - L.marginRightMm]
      : [L.marginTopMm, docPageH() - L.marginBottomMm];
    edges.forEach(edge => {
      const d = Math.abs(mm - edge);
      if (d < bestDist) { best = edge; bestDist = d; }
    });
  }
  return best;
}
function showLabelSetup() { clearSelection(); renderObjects(); }
function renderMarginGuides() {
  if (!els.marginGuide) return;
  const L = layoutSettings();
  const show = L.showMarginGuides && els.showMargins && els.showMargins.checked;
  els.marginGuide.classList.toggle('is-hidden', !show);
  if (!show) return;
  const z = state.zoom;
  els.marginGuide.style.left = (mmToPxX(L.marginLeftMm) * z) + 'px';
  els.marginGuide.style.top = (mmToPxY(L.marginTopMm) * z) + 'px';
  els.marginGuide.style.width = Math.max(0, mmToPxX(docPageW() - L.marginLeftMm - L.marginRightMm) * z) + 'px';
  els.marginGuide.style.height = Math.max(0, mmToPxY(docPageH() - L.marginTopMm - L.marginBottomMm) * z) + 'px';
}
function renderLabelProps() {
  const L = layoutSettings();
  if (els.propsHead) els.propsHead.textContent = T.labelSetup;
  let html = '<p class="text-body-secondary small">'+T.layoutHint+'</p>';
  html += propGroup(T.pageSize, '<div class="bt-prop-row">'+layoutCell('pageWidthMm', T.pageW, docPageW().toFixed(1))+layoutCell('pageHeightMm', T.pageH, docPageH().toFixed(1))+'</div>');
  html += propGroup(T.margins,
    '<div class="bt-prop-row">'+layoutCell('marginTopMm', T.marginTop, Number(L.marginTopMm).toFixed(1))+layoutCell('marginRightMm', T.marginRight, Number(L.marginRightMm).toFixed(1))+'</div>'
    +'<div class="bt-prop-row">'+layoutCell('marginBottomMm', T.marginBottom, Number(L.marginBottomMm).toFixed(1))+layoutCell('marginLeftMm', T.marginLeft, Number(L.marginLeftMm).toFixed(1))+'</div>'
    +'<label class="small">'+T.marginAll+'</label><input type="text" class="form-control form-control-sm mb-2" data-layout="marginAll" placeholder="0">');
  html += propGroup(T.gridStep, layoutCell('gridStepMm', T.gridStep, Number(L.gridStepMm).toFixed(1))
    + layoutCheck('showMarginGuides', T.showMargins, !!L.showMarginGuides)
    + layoutCheck('snapToMargins', T.snapMargins, !!L.snapToMargins));
  els.props.innerHTML = html;
  els.props.querySelectorAll('[data-layout]').forEach(inp => {
    inp.addEventListener('change', onLayoutInput);
    inp.addEventListener('input', onLayoutInput);
  });
}
function onLayoutInput(ev) {
  const input = ev.target, key = input.dataset.layout;
  if (!key || !state.document) return;
  mutate(() => {
    const L = layoutSettings();
    if (input.type === 'checkbox') {
      L[key] = input.checked;
      if (key === 'showMarginGuides') syncMarginCheckbox();
      return;
    }
    const val = Number(input.value);
    if (!Number.isFinite(val)) return;
    if (key === 'pageWidthMm' || key === 'pageHeightMm') {
      const w = key === 'pageWidthMm' ? val : docPageW();
      const h = key === 'pageHeightMm' ? val : docPageH();
      updatePageDimensions(w, h);
      return;
    }
    if (key === 'marginAll') {
      const m = Math.max(0, val);
      L.marginTopMm = L.marginRightMm = L.marginBottomMm = L.marginLeftMm = m;
      return;
    }
    const clamp = (key === 'gridStepMm') ? Math.max(0.1, Math.min(10, val)) : Math.max(0, Math.min(50, val));
    L[key] = clamp;
  });
  renderMarginGuides();
}

function snapPx(v, axis) {
  if (!els.snap.checked) return v;
  const mm = axis === 'x' ? pxToMmX(v) : pxToMmY(v);
  const s = snapMm(mm, axis);
  return axis === 'x' ? mmToPxX(s) : mmToPxY(s);
}

const GUIDE_THRESHOLD_MM = 0.35;
function clearGuides() {
  if (els.guides) els.guides.innerHTML = '';
  state.guideSnapPx = null;
}
function drawGuides(lines) {
  if (!els.guides) return;
  els.guides.innerHTML = '';
  const z = state.zoom;
  (lines || []).forEach(ln => {
    const el = document.createElement('div');
    if (ln.axis === 'x') {
      el.className = 'bt-guide-v';
      el.style.left = (ln.pos * z) + 'px';
    } else {
      el.className = 'bt-guide-h';
      el.style.top = (ln.pos * z) + 'px';
    }
    els.guides.appendChild(el);
  });
}
function collectGuideTargets(excludeId) {
  const L = layoutSettings();
  const xs = [0, docRefW(), mmToPxX(L.marginLeftMm), mmToPxX(docPageW() - L.marginRightMm)];
  const ys = [0, docRefH(), mmToPxY(L.marginTopMm), mmToPxY(docPageH() - L.marginBottomMm)];
  (state.pinnedGuides || []).forEach(g => {
    if (g.axis === 'v') xs.push(mmToPxX(g.mm));
    else ys.push(mmToPxY(g.mm));
  });
  editorObjects().forEach(o => {
    if (!o || o.id === excludeId || o.visible === false) return;
    const b = objectBox(o); if (!b) return;
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  });
  return { xs, ys };
}
function smartSnapMove(obj, x, y) {
  const thrX = mmToPxX(GUIDE_THRESHOLD_MM);
  const thrY = mmToPxY(GUIDE_THRESHOLD_MM);
  const box = objectBox(Object.assign({}, obj, (obj.id === 'serial' || obj.centerX != null)
    ? { centerX: x, y: y }
    : { x: x, y: y }));
  if (!box) return { x, y, lines: [] };
  const targets = collectGuideTargets(obj.id);
  const edgesX = [
    { kind: 'left', val: box.x },
    { kind: 'center', val: box.x + box.w / 2 },
    { kind: 'right', val: box.x + box.w },
  ];
  const edgesY = [
    { kind: 'top', val: box.y },
    { kind: 'middle', val: box.y + box.h / 2 },
    { kind: 'bottom', val: box.y + box.h },
  ];
  let bestDx = 0, bestDxDist = thrX, bestVx = null;
  edgesX.forEach(e => {
    targets.xs.forEach(t => {
      const d = Math.abs(e.val - t);
      if (d < bestDxDist) {
        bestDxDist = d;
        bestDx = t - e.val;
        bestVx = t;
      }
    });
  });
  let bestDy = 0, bestDyDist = thrY, bestHy = null;
  edgesY.forEach(e => {
    targets.ys.forEach(t => {
      const d = Math.abs(e.val - t);
      if (d < bestDyDist) {
        bestDyDist = d;
        bestDy = t - e.val;
        bestHy = t;
      }
    });
  });
  const lines = [];
  if (bestVx != null) lines.push({ axis: 'x', pos: bestVx });
  if (bestHy != null) lines.push({ axis: 'y', pos: bestHy });
  return { x: x + bestDx, y: y + bestDy, lines };
}
function setOverlayOpacity() {
  if (!els.labelOverlay || !els.overlayOpacity) return;
  els.labelOverlay.style.opacity = String((Number(els.overlayOpacity.value) || 0) / 100);
}
function syncOverlayControls() {
  const on = !!(els.showOverlay && els.showOverlay.checked);
  if (els.overlayOpacity) els.overlayOpacity.disabled = !on;
  if (!els.labelOverlay) return;
  if (!on) {
    els.labelOverlay.classList.add('is-hidden');
    return;
  }
  setOverlayOpacity();
  els.labelOverlay.classList.toggle('is-hidden', !state.overlayLoaded);
}
async function ensureOverlayImage() {
  if (!els.labelOverlay) return false;
  if (state.overlayLoaded && state.overlayUrl) {
    syncOverlayControls();
    return true;
  }
  const url = API + '?action=reference-overlay&_=' + Date.now();
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(T.overlayErr);
    const blob = await res.blob();
    if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
    state.overlayUrl = URL.createObjectURL(blob);
    els.labelOverlay.src = state.overlayUrl;
    state.overlayLoaded = true;
    syncOverlayControls();
    return true;
  } catch (err) {
    state.overlayLoaded = false;
    if (els.showOverlay) els.showOverlay.checked = false;
    syncOverlayControls();
    setStatus((err && err.message) || T.overlayErr, 'warning');
    return false;
  }
}
async function onOverlayToggle() {
  if (!els.showOverlay) return;
  if (els.showOverlay.checked) {
    await ensureOverlayImage();
  } else {
    syncOverlayControls();
  }
}
function setPreviewBusy(on) {
  if (els.previewBusy) els.previewBusy.classList.toggle('d-none', !on);
}
function schedulePreview() {
  if (!state.document) return;
  if (state.previewTimer) clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => { state.previewTimer = null; previewPdf(true); }, 500);
}

function dynamicFieldsObject(raw) {
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? deepClone(raw) : {};
}
function syncDynamicFields() {
  if (!state.document) return;
  const dyn = dynamicFieldsObject(state.document.dynamicFields);
  editorObjects().forEach(obj=>{
    if (!obj || obj.visible===false) return;
    if (obj.type==='qr') {
      dyn.qr = { x:num(obj.x,746), y:num(obj.y,40), size:num(obj.size,249) };
      dyn.qr.sizeMm = pxToMmX(num(obj.size,249));
    } else if (obj.type==='text') {
      const row = { fontPt:num(obj.fontPt,4.2), y:num(obj.y,0) };
      if (num(obj.fontMm,0) > 0) row.fontMm = num(obj.fontMm,0);
      if (obj.bold) row.style='B';
      if (obj.rotation) row.rotation=num(obj.rotation,0);
      if (obj.align==='center') row.align='center';
      if (obj.id==='serial' || obj.centerX!=null) {
        dyn.serial = Object.assign(dyn.serial||{}, row, { centerX:num(obj.centerX,898.5), w:num(obj.w,305) });
      } else if (['productTitleShort','specLine1','specLine2','specLine3','releaseLabel'].includes(obj.id)) {
        dyn[obj.id] = Object.assign(dyn[obj.id]||{}, row, { x:num(obj.x,52), w:num(obj.w,680) });
      }
    }
  });
  state.document.dynamicFields = dyn;
}
function pushHistory() {
  if (state.suppressHistory || !state.document) return;
  const snap = deepClone(state.document);
  if (state.historyIndex < state.history.length-1) state.history = state.history.slice(0, state.historyIndex+1);
  state.history.push(snap);
  if (state.history.length > state.maxHistory) state.history.shift();
  state.historyIndex = state.history.length-1;
  updateUndoButtons();
}
function undo() {
  if (state.historyIndex <= 0) return;
  state.suppressHistory = true;
  state.historyIndex--;
  state.document = deepClone(state.history[state.historyIndex]);
  state.suppressHistory = false;
  applyZoom();
  schedulePreview();
  updateDirtyUi();
}
function redo() {
  if (state.historyIndex >= state.history.length-1) return;
  state.suppressHistory = true;
  state.historyIndex++;
  state.document = deepClone(state.history[state.historyIndex]);
  state.suppressHistory = false;
  applyZoom();
  schedulePreview();
  updateDirtyUi();
}
function updateUndoButtons() {
  const u=$('btUndo'), r=$('btRedo');
  if (u) u.disabled = state.historyIndex <= 0;
  if (r) r.disabled = state.historyIndex >= state.history.length-1;
}
function mutate(fn) {
  pushHistory();
  fn();
  syncDynamicFields();
  applyZoom();
  schedulePreview();
  updateDirtyUi();
}
function updateDirtyUi() {
  const dirty = hasUnsavedChanges();
  if (els.dirtyBadge) els.dirtyBadge.classList.toggle('d-none', !dirty);
  if (els.dirtyStatus) els.dirtyStatus.classList.toggle('d-none', !dirty);
  if (els.saveBtn) {
    els.saveBtn.classList.toggle('btn-warning', dirty);
    els.saveBtn.classList.toggle('btn-primary', !dirty);
    els.saveBtn.classList.toggle('bt-save-dirty', dirty);
  }
  document.title = (dirty ? '* ' : '') + 'Редактор шаблона шильда';
  if (dirty) scheduleDraftSave();
}
function objectBox(obj) {
  if (!obj) return null;
  if (obj.type==='qr') {
    const bt = String(obj.barcodeType||'qr').toLowerCase();
    if (bt === 'code128' || bt === 'c128') {
      const w = num(obj.w, num(obj.size, 249));
      const h = num(obj.h, Math.max(40, w * 0.28));
      return {x:num(obj.x,0),y:num(obj.y,0),w,h};
    }
    const size=num(obj.size,249); return {x:num(obj.x,0),y:num(obj.y,0),w:size,h:size};
  }
  if (obj.type==='image' || obj.type==='box') return {x:num(obj.x,0),y:num(obj.y,0),w:num(obj.w,100),h:num(obj.h,100)};
  if (obj.type==='line') {
    const x1=num(obj.x,0), y1=num(obj.y,0);
    const x2 = obj.x2 != null ? num(obj.x2,x1) : x1 + num(obj.w,100);
    const y2 = obj.y2 != null ? num(obj.y2,y1) : y1 + num(obj.h,0);
    const minX=Math.min(x1,x2), minY=Math.min(y1,y2);
    return {x:minX,y:minY,w:Math.max(4,Math.abs(x2-x1)),h:Math.max(4,Math.abs(y2-y1)),x1,y1,x2,y2};
  }
  if (obj.id==='serial' || (obj.align==='center' && obj.centerX!=null)) {
    const w=num(obj.w,305), cx=num(obj.centerX,898.5), rot=num(obj.rotation,0), h=lineHeightPx(obj);
    if (Math.abs(rot)===90||Math.abs(rot)===270) return {x:cx-h/2,y:num(obj.y,310),w:h,h:w,rotation:rot,centerX:cx};
    return {x:cx-w/2,y:num(obj.y,310),w,h,rotation:rot,centerX:cx};
  }
  return {x:num(obj.x,0),y:num(obj.y,0),w:num(obj.w,680),h:lineHeightPx(obj),rotation:num(obj.rotation,0)};
}
function objectIcon(obj) {
  if (obj.type==='qr') return ICONS.qr;
  if (obj.type==='image') return ICONS.image;
  if (obj.type==='line') return ICONS.line;
  if (obj.type==='box') return ICONS.box;
  if (obj.id==='serial') return ICONS.serial;
  return ICONS.text;
}
function nearestRightAngle(deg) {
  const d = ((num(deg,0) % 360) + 360) % 360;
  const opts = [0, 90, 270];
  let best = 0, bestDist = 1e9;
  opts.forEach(o => {
    let dist = Math.abs(d - o);
    if (dist > 180) dist = 360 - dist;
    if (dist < bestDist) { bestDist = dist; best = o; }
  });
  return best;
}
function sampleText(obj) {
  const lines=(els.sampleConfig.value||'').split(/\r?\n/).map(s=>s.trim());
  const map={
    specLine1:lines[0]||T.s1, specLine2:lines[1]||T.s2, specLine3:lines[2]||T.s3,
    releaseLabel:els.sampleRelease.value||T.relDef, serial:els.sampleSerial.value||sampleSerialDefault(),
    productTitleShort:sampleProductTitle(), orderNumber:T.order,
    manufactureDate:new Date().toLocaleDateString('ru-RU'),
  };
  if (obj.type==='qr') return map.serial;
  if (obj.fixedText != null && String(obj.fixedText).trim() !== '') return String(obj.fixedText);
  const key = obj.dataField || obj.id;
  return map[key] || obj.label || T.customText;
}
function applyZoom() {
  if (!state.document) return;
  const w=Math.round(docRefW()*state.zoom), h=Math.round(docRefH()*state.zoom);
  els.labelStage.style.width=w+'px'; els.labelStage.style.height=h+'px';
  els.labelOuter.style.width=w+'px'; els.labelOuter.style.height=h+'px';
  els.zoomLabel.textContent=Math.round(state.zoom*100)+'%';
  updateGrid(); drawRulers(); renderMarginGuides(); renderObjects();
}
function updateGrid() {
  const step = Math.max(0.1, Number(layoutSettings().gridStepMm) || 1);
  els.grid.style.backgroundSize=(mmToPxX(step)*state.zoom)+'px '+(mmToPxY(step)*state.zoom)+'px';
  els.grid.classList.toggle('is-hidden',!els.showGrid.checked);
  els.labelStage.classList.toggle('no-bg',!els.showBg.checked);
  renderMarginGuides();
}
function drawRulers() {
  const z=state.zoom, rw=els.canvasScroll.clientWidth||800, rh=els.canvasScroll.clientHeight||400;
  const ch=els.rulerH, cv=els.rulerV; ch.width=rw; ch.height=26; cv.width=26; cv.height=rh;
  const ctxH=ch.getContext('2d'), ctxV=cv.getContext('2d');
  ctxH.fillStyle='#4a4f57'; ctxH.fillRect(0,0,rw,26); ctxV.fillStyle='#4a4f57'; ctxV.fillRect(0,0,26,rh);
  ctxH.strokeStyle=ctxV.strokeStyle='#6b7280'; ctxH.fillStyle=ctxV.fillStyle='#c8ccd2'; ctxH.font=ctxV.font='9px sans-serif';
  const pad=32;
  for (let mm=0; mm<=docPageW(); mm++) { const x=pad+mmToPxX(mm)*z; if (x>rw) break; const maj=mm%5===0; ctxH.beginPath(); ctxH.moveTo(x,maj?8:16); ctxH.lineTo(x,26); ctxH.stroke(); if (maj&&mm>0) ctxH.fillText(String(mm),x+2,9); }
  for (let mm=0; mm<=docPageH(); mm++) { const y=pad+mmToPxY(mm)*z; if (y>rh) break; const maj=mm%5===0; ctxV.beginPath(); ctxV.moveTo(maj?8:16,y); ctxV.lineTo(26,y); ctxV.stroke(); if (maj&&mm>0) { ctxV.save(); ctxV.translate(9,y-2); ctxV.rotate(-Math.PI/2); ctxV.fillText(String(mm),0,0); ctxV.restore(); } }
}
function sortedObjects() {
  return editorObjects().slice().sort((a,b)=>num(a.zIndex,0)-num(b.zIndex,0));
}
function renderObjectList() {
  els.objList.innerHTML='';
  const q = String(state.layerFilter || '').trim().toLowerCase();
  (state.staticObjects||[]).forEach(st=>{
    if (q) {
      const hay = ((st.label||'')+' '+(st.name||'')).toLowerCase();
      if (!hay.includes(q)) return;
    }
    const li=document.createElement('li'); li.className='bt-obj-item is-static';
    li.innerHTML='<span class="bt-obj-icon"><i class="bi '+(st.icon||'bi-image')+'"></i></span><span class="flex-grow-1"><div class="bt-obj-name">'+esc(st.label||st.name)+'</div><div class="bt-obj-type">'+esc(st.name)+' \u00b7 '+T.static+'</div></span>';
    els.objList.appendChild(li);
  });
  sortedObjects().slice().reverse().forEach(obj=>{
    if (q) {
      const hay = ((obj.label||'')+' '+(obj.name||'')+' '+(obj.id||'')+' '+(obj.type||'')).toLowerCase();
      if (!hay.includes(q)) return;
    }
    const hidden = obj.visible===false;
    const li=document.createElement('li');
    li.className='bt-obj-item'+(isSelected(obj.id)?' is-selected':'')+(obj.locked?' is-locked-item':'')+(hidden?' is-hidden-item':'');
    const icon=objectIcon(obj);
    const eyeIcon = hidden ? 'bi-eye-slash' : 'bi-eye';
    const lockIcon = obj.locked ? 'bi-lock-fill' : 'bi-unlock';
    li.draggable = !q;
    li.dataset.objId = obj.id;
    li.innerHTML='<span class="bt-obj-drag" title="Перетащить для порядка слоёв"><i class="bi bi-grip-vertical"></i></span>'
      +'<span class="bt-obj-icon"><i class="bi '+icon+'"></i></span>'
      +'<span class="flex-grow-1"><div class="bt-obj-name">'+esc(obj.label||obj.name)+'</div><div class="bt-obj-type">'+esc(obj.name)+' \u00b7 z'+num(obj.zIndex,0)+'</div></span>'
      +'<span class="bt-obj-actions">'
      +'<button type="button" class="btn btn-link btn-sm text-secondary" data-act="vis" title="'+(hidden?T.show:T.hide)+'"><i class="bi '+eyeIcon+'"></i></button>'
      +'<button type="button" class="btn btn-link btn-sm text-secondary" data-act="lock" title="'+(obj.locked?T.unlock:T.lock)+'"><i class="bi '+lockIcon+'"></i></button>'
      +'</span>';
    li.onclick=(ev)=>{
      const btn = ev.target.closest('[data-act]');
      if (btn) {
        ev.preventDefault(); ev.stopPropagation();
        const act = btn.getAttribute('data-act');
        if (act==='vis') mutate(()=>{ obj.visible = obj.visible===false; });
        else if (act==='lock') mutate(()=>{ obj.locked = !obj.locked; });
        return;
      }
      if (ev.target.closest('.bt-obj-drag')) return;
      selectObject(obj.id, { toggle: !!(ev.ctrlKey || ev.metaKey), add: !!ev.shiftKey && !(ev.ctrlKey || ev.metaKey) && selectedList().length });
    };
    li.addEventListener('dragstart', (ev) => {
      if (q || ev.target.closest('[data-act]')) { ev.preventDefault(); return; }
      state.layerDragId = obj.id;
      li.classList.add('is-dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', obj.id);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('is-dragging');
      state.layerDragId = null;
      els.objList.querySelectorAll('.bt-obj-item.is-drop-target').forEach(n => n.classList.remove('is-drop-target'));
    });
    li.addEventListener('dragover', (ev) => {
      if (!state.layerDragId || state.layerDragId === obj.id) return;
      ev.preventDefault();
      li.classList.add('is-drop-target');
      ev.dataTransfer.dropEffect = 'move';
    });
    li.addEventListener('dragleave', () => li.classList.remove('is-drop-target'));
    li.addEventListener('drop', (ev) => {
      ev.preventDefault();
      li.classList.remove('is-drop-target');
      const fromId = state.layerDragId || ev.dataTransfer.getData('text/plain');
      if (!fromId || fromId === obj.id) return;
      reorderLayer(fromId, obj.id);
    });
    els.objList.appendChild(li);
  });
}
function renderObjects() {
  if (!state.document) return;
  const z=state.zoom; els.objects.innerHTML='';
  sortedObjects().forEach(obj=>{
    if (obj.type==='static') return;
    const hidden = obj.visible===false;
    const box=objectBox(obj); if (!box) return;
    const el=document.createElement('div');
    let cls = 'text';
    if (obj.type==='qr') cls = 'qr';
    else if (obj.type==='image') cls = 'image';
    else if (obj.type==='line') cls = 'line';
    else if (obj.type==='box') cls = 'box';
    else if (obj.id==='serial') cls = 'serial';
    el.className='bt-obj is-'+cls+(isSelected(obj.id)?' is-selected':'')+(state.hoverId===obj.id?' is-hover':'')+(obj.locked?' is-locked':'')+(hidden?' is-ghost':'');
    el.dataset.id=obj.id;
    el.style.left=(box.x*z)+'px'; el.style.top=(box.y*z)+'px';
    el.style.width=Math.max(4,box.w*z)+'px'; el.style.height=Math.max(4,box.h*z)+'px';
    el.style.zIndex=String(num(obj.zIndex,0));
    if (hidden) {
      el.title = (obj.label||obj.name||obj.id) + ' (скрыт)';
    } else if (obj.type==='qr') {
      const bt = String(obj.barcodeType||'qr').toLowerCase();
      const q=document.createElement('div');
      q.className='bt-qr-mock'+(bt==='datamatrix'?' is-datamatrix':(bt==='code128'||bt==='c128'?' is-code128':''));
      el.appendChild(q);
    } else if (obj.type==='image') {
      const im=document.createElement('img'); im.className='bt-obj-image'; im.src=obj.imageData||''; im.alt=''; im.draggable=false; el.appendChild(im);
    } else if (obj.type==='line') {
      const stroke=document.createElement('div'); stroke.className='bt-line-stroke';
      const x1=num(box.x1, box.x), y1=num(box.y1, box.y), x2=num(box.x2, box.x+box.w), y2=num(box.y2, box.y);
      const dx=(x2-x1)*z, dy=(y2-y1)*z;
      const len=Math.sqrt(dx*dx+dy*dy)||1;
      const ang=Math.atan2(dy,dx)*180/Math.PI;
      stroke.style.width=len+'px';
      stroke.style.left=((x1-box.x)*z)+'px';
      stroke.style.top=((y1-box.y)*z)+'px';
      stroke.style.transform='rotate('+ang+'deg)';
      stroke.style.borderTopWidth=Math.max(1, num(obj.strokeWidth,2)*z)+'px';
      el.appendChild(stroke);
    } else if (obj.type==='box') {
      const sh=document.createElement('div'); sh.className='bt-box-shape'+(obj.filled?' is-filled':'');
      sh.style.borderWidth=Math.max(1, num(obj.strokeWidth,2)*z)+'px';
      el.appendChild(sh);
    } else {
      const p=document.createElement('div'); p.className='bt-obj-preview';
      const text = sampleText(obj);
      let fpx = fontPxForObj(obj);
      if (!obj.wrap) fpx = fitFontPxToWidth(text, fpx, num(obj.w, box.w), obj);
      p.style.fontSize=(fpx*z)+'px';
      p.style.fontFamily=fontFamilyForObj(obj);
      if (obj.bold) p.style.fontWeight='700';
      if (obj.align==='center' || obj.centerX!=null) p.style.textAlign='center';
      if (fpx < 48 && !obj.wrap) p.classList.add('is-thermal-stroke');
      p.textContent=text;
      if (obj.wrap || String(obj.fixedText||'').includes('\n')) { p.style.whiteSpace='pre-wrap'; p.style.textOverflow='clip'; p.style.overflow='hidden'; }
      else { p.style.whiteSpace='nowrap'; }
      if (box.rotation) { p.style.transform='rotate('+box.rotation+'deg)'; p.style.transformOrigin=(obj.id==='serial'||obj.centerX!=null)?'center center':'left top'; }
      el.appendChild(p);
    }
    if (state.selectedId===obj.id && selectedList().length===1 && !obj.locked && !hidden) {
      ['nw','n','ne','e','se','s','sw','w'].forEach(h=>{ const hd=document.createElement('span'); hd.className='bt-handle bt-handle-'+h; hd.dataset.handle=h; el.appendChild(hd); });
      if (obj.type==='text' || obj.type==='box') {
        const rh=document.createElement('span'); rh.className='bt-handle bt-handle-rotate'; rh.dataset.handle='rotate'; rh.title='Поворот'; el.appendChild(rh);
      }
    }
    els.objects.appendChild(el);
  });
  renderPinnedGuides();
  renderObjectList(); renderProps(); renderFieldsPanel(); updateStatusBar();
}
function updateStatusBar() {
  if (els.statusZoom) els.statusZoom.textContent = Math.round(state.zoom * 100) + '%';
  if (els.selCount) els.selCount.textContent = String(selectedList().length);
  const many = selectedList().length > 1;
  const obj=getObject(state.selectedId);
  if (!obj) {
    els.selName.textContent='\u2014';
    if (els.selSize) els.selSize.textContent='\u2014';
    if (state.cursorMm.x != null && els.cursorX) {
      els.cursorX.textContent = state.cursorMm.x.toFixed(1);
      els.cursorY.textContent = state.cursorMm.y.toFixed(1);
    }
    updateDirtyUi();
    return;
  }
  els.selName.textContent = many ? (T.multiSelected + selectedList().length) : (obj.name||obj.id);
  const box=objectBox(obj);
  if (box) {
    els.cursorX.textContent=pxToMmX(box.x).toFixed(1);
    els.cursorY.textContent=pxToMmY(box.y).toFixed(1);
    if (els.selSize) els.selSize.textContent = pxToMmX(box.w).toFixed(1) + '\u00d7' + pxToMmY(box.h).toFixed(1);
  }
  updateDirtyUi();
}
function updateCursorFromEvent(ev) {
  if (!els.labelStage) return;
  const p = stagePoint(ev.clientX, ev.clientY);
  state.cursorMm = { x: pxToMmX(p.x), y: pxToMmY(p.y) };
  if (!state.selectedId) {
    if (els.cursorX) els.cursorX.textContent = state.cursorMm.x.toFixed(1);
    if (els.cursorY) els.cursorY.textContent = state.cursorMm.y.toFixed(1);
  }
  updateCrosshairs(p.x, p.y, ev);
}
function updateCrosshairs(xPx, yPx, ev) {
  const z = state.zoom;
  const show = !state.drag && !state.pan;
  const setHair = (el, on) => { if (el) el.classList.toggle('is-hidden', !on); };
  setHair(els.crosshairV, show);
  setHair(els.crosshairH, show);
  if (els.crosshairV) els.crosshairV.style.left = (xPx * z) + 'px';
  if (els.crosshairH) els.crosshairH.style.top = (yPx * z) + 'px';

  // Ruler markers relative to canvas scroll content + ruler size (24px)
  if (els.canvasScroll && els.rulerHairV && els.rulerHairH) {
    const scroll = els.canvasScroll;
    const stageRect = els.labelStage.getBoundingClientRect();
    const left = (ev.clientX - stageRect.left) + 0; // already in stage CSS px via xPx*z conceptually
    // Place hair on ruler track using client coords relative to rulers
    const rh = els.rulerH ? els.rulerH.parentElement.getBoundingClientRect() : null;
    const rv = els.rulerV ? els.rulerV.parentElement.getBoundingClientRect() : null;
    if (rh) {
      els.rulerHairV.classList.toggle('is-hidden', !show);
      els.rulerHairV.style.left = Math.max(0, Math.min(rh.width - 1, ev.clientX - rh.left)) + 'px';
    }
    if (rv) {
      els.rulerHairH.classList.toggle('is-hidden', !show);
      els.rulerHairH.style.top = Math.max(0, Math.min(rv.height - 1, ev.clientY - rv.top)) + 'px';
    }
  }
}
function selectedList() { return Array.isArray(state.selectedIds) ? state.selectedIds : []; }
function isSelected(id) { return selectedList().includes(id); }
function getSelectedObjects() {
  return selectedList().map(getObject).filter(o => o && o.type !== 'static');
}
function setSelection(ids, primary) {
  const uniq = [];
  (ids || []).forEach(id => { if (id && !uniq.includes(id) && getObject(id)) uniq.push(id); });
  state.selectedIds = uniq;
  if (primary && uniq.includes(primary)) state.selectedId = primary;
  else state.selectedId = uniq.length ? uniq[uniq.length - 1] : null;
}
function clearSelection() { state.selectedId = null; state.selectedIds = []; }
function selectObject(id, opts) {
  opts = opts || {};
  if (id == null) {
    clearSelection();
  } else if (opts.toggle) {
    const next = selectedList().slice();
    const i = next.indexOf(id);
    if (i >= 0) next.splice(i, 1);
    else next.push(id);
    setSelection(next, id);
  } else if (opts.add) {
    const next = selectedList().slice();
    if (!next.includes(id)) next.push(id);
    setSelection(next, id);
  } else {
    setSelection([id], id);
  }
  renderObjects();
  if (id) ensureSelectionVisible();
}
function selectAllObjects() {
  const ids = sortedObjects().filter(o => o && o.type !== 'static').map(o => o.id);
  setSelection(ids, ids[0] || null);
  renderObjects();
}
function dataSourceOptions(selected) {
  let html='';
  (state.dataSources||[]).forEach(src=>{
    html+='<option value="'+esc(src.key)+'"'+(selected===src.key?' selected':'')+'>'+esc(src.label)+'</option>';
  });
  return html;
}
function renderProps() {
  const many = selectedList().length > 1;
  if (many) {
    if (els.propsHead) els.propsHead.textContent = T.multiSelected + selectedList().length;
    els.props.innerHTML = '<p class="text-body-secondary small mb-2">'+esc(T.multiSelected)+selectedList().length+'</p>'
      + '<div class="d-flex flex-wrap gap-1 mb-2">'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="lock">'+esc(T.lock)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="hide">'+esc(T.hide)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="dup">'+esc(T.dup)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="match">'+esc('Как у активного')+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="sw">'+esc(T.sameW)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="sh">'+esc(T.sameH)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="center">'+esc(T.centerLabel)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="style">'+esc('Вставить стиль')+'</button>'
      + '<button type="button" class="btn btn-outline-danger btn-sm" data-multi="del">'+esc(T.del)+'</button>'
      + '</div>'
      + '<div class="d-flex flex-wrap gap-1">'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="al">'+esc(T.alignLeft)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="ac">'+esc(T.alignCenter)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="ar">'+esc(T.alignRight)+'</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="dh">H</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" data-multi="dv">V</button>'
      + '</div>';
    els.props.querySelectorAll('[data-multi]').forEach(btn => {
      btn.onclick = () => {
        const a = btn.getAttribute('data-multi');
        if (a === 'lock') toggleLock();
        else if (a === 'hide') toggleVisible();
        else if (a === 'dup') duplicateSelected();
        else if (a === 'del') deleteSelected();
        else if (a === 'match') matchSizeToPrimary();
        else if (a === 'sw') matchDimension('w');
        else if (a === 'sh') matchDimension('h');
        else if (a === 'center') centerSelectionOnLabel();
        else if (a === 'style') pasteStyle();
        else if (a === 'al') alignSelected('left');
        else if (a === 'ac') alignSelected('centerX');
        else if (a === 'ar') alignSelected('right');
        else if (a === 'dh') distributeSelected('h');
        else if (a === 'dv') distributeSelected('v');
      };
    });
    return;
  }
  const obj=getObject(state.selectedId);
  if (!obj || obj.type==='static') { renderLabelProps(); return; }
  if (els.propsHead) els.propsHead.textContent = '\u0421\u0432\u043e\u0439\u0441\u0442\u0432\u0430 \u043e\u0431\u044a\u0435\u043a\u0442\u0430';
  const box=objectBox(obj), tab=state.propsTab;
  const isGeom = obj.type==='image' || obj.type==='line' || obj.type==='box';
  let html = isGeom ? '' : '<div class="bt-props-tabs">'+tabBtn('position',T.pos,tab)+tabBtn('font',T.font,tab)+tabBtn('data',T.data,tab)+'</div>';
  if (isGeom || tab==='position') {
    html+=propGroup(T.posMm, positionFields(obj,box));
    if (obj.type==='qr') {
      const bt = String(obj.barcodeType||'qr').toLowerCase();
      const btVal = (bt==='datamatrix'?'datamatrix':(bt==='code128'||bt==='c128'?'code128':'qr'));
      if (btVal==='code128') {
        html+=propGroup(T.qrSize, '<div class="bt-prop-row">'+cell('wmm',T.wMm,pxToMmX(num(obj.w,num(obj.size,249))).toFixed(2))+cell('hmm',T.hMm,pxToMmY(num(obj.h,Math.max(40,num(obj.size,249)*0.28))).toFixed(2))+'</div>');
      } else {
        html+=propGroup(T.qrSize, propInput('sizeMm',T.sideMm,pxToMmX(num(obj.size,249)).toFixed(2),'qrSizeMm'));
      }
      html+=propGroup(T.barcodeType, propSelect('barcodeType',T.barcodeType,btVal,[['qr',T.barcodeQr],['datamatrix',T.barcodeDm],['code128',T.barcodeC128]]));
    }
    if (obj.type==='image') html+=propGroup(T.imageSize, '<div class="small text-body-secondary">'+esc((obj.imageData||'').slice(0,32))+'…</div>');
    if (obj.type==='box') html+=propCheck('filled','Заливка',!!obj.filled);
    if (obj.type==='image' || obj.type==='box' || obj.type==='qr') html+=propCheck('lockAspect','Пропорции',!!obj.lockAspect);
    if (obj.type==='text' || obj.type==='box') html+=propGroup(T.rot, propSelect('rotation',T.angle,String(num(obj.rotation,0)),[['0',T.h0],['90',T.h90],['270',T.h270]]));
  } else if (!isGeom && tab==='font' && obj.type!=='qr') {
    const mmVal = num(obj.fontMm,0) > 0 ? num(obj.fontMm,0) : fontMmFromPt(obj.fontPt);
    html+=propGroup(T.font,
      propInput('fontMm',T.fontMmLabel,mmVal.toFixed(2),'fontMm')
      +propInput('fontPt',T.sizePt,num(obj.fontPt,4.2).toFixed(2),'fontPt')
      +propCheck('bold',T.bold,!!obj.bold));
    if (obj.type==='text') html+=propSelect('align',T.align,obj.align||'left',[['left',T.alignL],['center',T.alignC]])+propCheck('wrap','Перенос строк',!!obj.wrap);
    html+='<button type="button" class="btn btn-outline-secondary btn-sm mt-1" id="btFitTextW">Ширина под текст</button>';
  } else if (!isGeom && tab==='data') {
    html+=propGroup(T.fixedText, propTextarea('fixedText', T.fixedText, obj.fixedText||'')+'<div class="small text-body-secondary mt-1 mb-2">'+T.fixedTextHint+'</div>');
    html+=propGroup(T.src, '<label class="small">'+T.src+'</label><select class="form-select form-select-sm" data-prop="dataField">'+dataSourceOptions(obj.dataField||obj.id)+'</select><div class="small text-body-secondary mt-2 mb-1">'+T.btField+'<code>'+esc(obj.bartenderField||obj.name)+'</code></div><div class="bt-data-preview">'+esc(sampleText(obj))+'</div>');
  }
  html+=propGroup(T.name, propInput('label',T.name,obj.label||obj.name,'label')+propCheck('visible',T.visible,obj.visible!==false)+propCheck('locked',T.locked,!!obj.locked));
  els.props.innerHTML=html;
  els.props.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{state.propsTab=btn.dataset.tab;renderProps();}));
  els.props.querySelectorAll('[data-prop]').forEach(inp=>{inp.addEventListener('change',onPropInput);inp.addEventListener('input',onPropInput);});
  const fitBtn = els.props.querySelector('#btFitTextW');
  if (fitBtn) fitBtn.onclick = () => fitTextWidth();
}
function tabBtn(key,label,active) { return '<button type="button" class="bt-props-tab'+(active===key?' is-active':'')+'" data-tab="'+key+'">'+label+'</button>'; }
function propGroup(title,body) { return '<div class="bt-prop-group"><div class="bt-prop-group-title">'+title+'</div>'+body+'</div>'; }
function propInput(n,l,v,k) { return '<label class="small">'+l+'</label><input type="text" class="form-control form-control-sm" data-prop="'+k+'" value="'+esc(String(v))+'">'; }
function propTextarea(k,l,v) { return '<label class="small">'+l+'</label><textarea class="form-control form-control-sm" rows="3" data-prop="'+k+'">'+esc(String(v))+'</textarea>'; }
function propCheck(n,l,c) { return '<label class="bt-check-inline"><input type="checkbox" data-prop="'+n+'" '+(c?'checked':'')+'> '+l+'</label>'; }
function propSelect(n,l,v,opts) { let o='<label class="small">'+l+'</label><select class="form-select form-select-sm" data-prop="'+n+'">'; opts.forEach(p=>o+='<option value="'+p[0]+'"'+(String(v)===p[0]?' selected':'')+'>'+esc(p[1])+'</option>'); return o+'</select>'; }
function positionFields(obj,box) {
  if (obj.id==='serial' || (obj.align==='center' && obj.centerX!=null)) {
    return '<div class="bt-prop-row">'+cell('centerXmm',T.cxMm,pxToMmX(num(obj.centerX,898.5)).toFixed(2))+cell('ymm',T.yMm,pxToMmY(num(obj.y,0)).toFixed(2))+cell('wmm',T.wMm,pxToMmX(num(obj.w,305)).toFixed(2))+'</div>';
  }
  if (obj.type==='qr' && !(['code128','c128'].includes(String(obj.barcodeType||'').toLowerCase()))) return '<div class="bt-prop-row">'+cell('xmm',T.xMm,pxToMmX(num(obj.x,0)).toFixed(2))+cell('ymm',T.yMm,pxToMmY(num(obj.y,0)).toFixed(2))+'</div>';
  if (obj.type==='image' || obj.type==='box' || obj.type==='line' || (obj.type==='qr' && ['code128','c128'].includes(String(obj.barcodeType||'').toLowerCase()))) return '<div class="bt-prop-row">'+cell('xmm',T.xMm,pxToMmX(num(obj.x,0)).toFixed(2))+cell('ymm',T.yMm,pxToMmY(num(obj.y,0)).toFixed(2))+cell('wmm',T.wMm,pxToMmX(num(obj.w,100)).toFixed(2))+cell('hmm',T.hMm,pxToMmY(num(obj.h, obj.type==='line'?4:100)).toFixed(2))+'</div>';
  return '<div class="bt-prop-row">'+cell('xmm',T.xMm,pxToMmX(num(obj.x,0)).toFixed(2))+cell('ymm',T.yMm,pxToMmY(num(obj.y,0)).toFixed(2))+cell('wmm',T.wMm,pxToMmX(num(obj.w,680)).toFixed(2))+cell('hmm',T.hMm,pxToMmY(box.h).toFixed(2))+'</div>';
}
function cell(prop,label,value) { return '<div><label>'+label+'</label><input class="form-control form-control-sm" data-prop="'+prop+'" value="'+esc(value)+'"></div>'; }
function layoutCell(prop,label,value) { return '<div><label>'+label+'</label><input class="form-control form-control-sm" data-layout="'+prop+'" value="'+esc(value)+'"></div>'; }
function layoutCheck(n,l,c) { return '<label class="bt-check-inline"><input type="checkbox" data-layout="'+n+'" '+(c?'checked':'')+'> '+l+'</label>'; }
function onPropInput(ev) {
  const input=ev.target, prop=input.dataset.prop, id=state.selectedId;
  const obj=getObject(id); if (!obj||!prop) return;
  mutate(()=>{
    if (input.type==='checkbox') { obj[prop]=input.checked; return; }
    const val=input.value;
    if (prop==='xmm') obj.x=snapPx(mmToPxX(Number(val)),'x');
    else if (prop==='ymm') obj.y=snapPx(mmToPxY(Number(val)),'y');
    else if (prop==='wmm') {
      obj.w=mmToPxX(Number(val));
      if (obj.centerX!=null) obj.centerX=obj.x+obj.w/2;
      if (obj.type==='qr' && (String(obj.barcodeType||'').toLowerCase()==='code128')) obj.size = obj.w;
      if (obj.type==='line') { obj.x2 = num(obj.x,0) + obj.w; obj.y2 = num(obj.y2, num(obj.y,0)); }
    }
    else if (prop==='hmm') {
      obj.h=mmToPxY(Number(val));
      if (obj.type==='line') { obj.y2 = num(obj.y,0) + obj.h; obj.x2 = num(obj.x2, num(obj.x,0)+num(obj.w,0)); }
    }
    else if (prop==='centerXmm') obj.centerX=mmToPxX(Number(val));
    else if (prop==='qrSizeMm') { obj.size=mmToPxX(Number(val)); }
    else if (prop==='fontMm') { obj.fontMm=Number(val); obj.fontPt=fontPtFromMm(obj.fontMm); }
    else if (prop==='fontPt') { obj.fontPt=Number(val); obj.fontMm=fontMmFromPt(obj.fontPt); }
    else if (prop==='rotation') obj.rotation=Number(val);
    else if (prop==='align') { obj.align=val; if (val==='center' && obj.centerX==null) obj.centerX=obj.x+obj.w/2; }
    else if (prop==='dataField') obj.dataField=val;
    else if (prop==='barcodeType') {
      obj.barcodeType = (val === 'datamatrix') ? 'datamatrix' : (val === 'code128' ? 'code128' : 'qr');
      if (obj.barcodeType === 'code128') {
        if (obj.w == null) obj.w = num(obj.size, 249);
        if (obj.h == null) obj.h = Math.max(40, num(obj.w, 249) * 0.28);
      }
    }
    else if (prop==='filled') obj.filled = !!input.checked;
    else if (prop==='label') obj.label=val;
    else if (prop==='fixedText') obj.fixedText=val;
    else obj[prop]=val;
  });
}
function stagePoint(cx,cy) { const r=els.labelStage.getBoundingClientRect(), z=state.zoom; return {x:(cx-r.left)/z,y:(cy-r.top)/z}; }
function updateMarqueeEl(a, b) {
  if (!els.marquee) return;
  const z = state.zoom;
  const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y);
  els.marquee.classList.remove('is-hidden');
  els.marquee.style.left = (x1 * z) + 'px';
  els.marquee.style.top = (y1 * z) + 'px';
  els.marquee.style.width = Math.max(1, (x2 - x1) * z) + 'px';
  els.marquee.style.height = Math.max(1, (y2 - y1) * z) + 'px';
}
function hideMarquee() {
  if (els.marquee) els.marquee.classList.add('is-hidden');
}
function finishMarquee(addTo) {
  const m = state.marquee;
  state.marquee = null;
  hideMarquee();
  if (!m) return;
  const x1 = Math.min(m.start.x, m.end.x), y1 = Math.min(m.start.y, m.end.y);
  const x2 = Math.max(m.start.x, m.end.x), y2 = Math.max(m.start.y, m.end.y);
  if ((x2 - x1) < 2 && (y2 - y1) < 2) {
    if (!addTo) { clearSelection(); renderObjects(); }
    return;
  }
  const hit = [];
  sortedObjects().forEach(obj => {
    if (!obj || obj.type === 'static') return;
    const box = objectBox(obj); if (!box) return;
    const ox2 = box.x + box.w, oy2 = box.y + box.h;
    if (box.x < x2 && ox2 > x1 && box.y < y2 && oy2 > y1) hit.push(obj.id);
  });
  if (addTo) {
    const next = selectedList().slice();
    hit.forEach(id => { if (!next.includes(id)) next.push(id); });
    setSelection(next, hit[hit.length - 1] || state.selectedId);
  } else {
    setSelection(hit, hit[hit.length - 1] || null);
  }
  renderObjects();
}
function onPointerDown(ev) {
  if (state.spaceDown || ev.button === 1) return; // pan handled on scroll container
  if (ev.button === 2) return; // context menu
  const handle=ev.target.closest('.bt-handle'), objEl=ev.target.closest('.bt-obj');
  if (!objEl) {
    ev.preventDefault();
    const ptr = stagePoint(ev.clientX, ev.clientY);
    state.marquee = { start: ptr, end: ptr, add: !!(ev.shiftKey || ev.ctrlKey || ev.metaKey) };
    if (!state.marquee.add) clearSelection();
    updateMarqueeEl(ptr, ptr);
    renderObjects();
    window.addEventListener('pointermove', onMarqueeMove);
    window.addEventListener('pointerup', onMarqueeUp);
    return;
  }
  ev.preventDefault();
  const id=objEl.dataset.id; const obj=getObject(id); if (!obj) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod) {
    selectObject(id, { toggle: true });
    return;
  }
  if (!isSelected(id)) selectObject(id);
  else { state.selectedId = id; }
  if (obj.locked) { renderObjects(); return; }
  const groupIds = selectedList().length > 1 ? selectedList().filter(sid => {
    const o = getObject(sid); return o && !o.locked && o.type !== 'static';
  }) : [id];
  const starts = {};
  if (obj.groupId && !handle && groupIds.length <= 1) {
    editorObjects().forEach(o => { if (o && o.groupId === obj.groupId && !groupIds.includes(o.id)) groupIds.push(o.id); });
  }
  groupIds.forEach(sid => { const o = getObject(sid); if (o) starts[sid] = deepClone(o); });
  state.drag={id, handle:handle?handle.dataset.handle:null, startPtr:stagePoint(ev.clientX,ev.clientY), startBox:deepClone(objectBox(obj)), startObj:deepClone(obj), starts, groupIds, moved:false, historyPushed:false, axis:null};
  window.addEventListener('pointermove',onPointerMove); window.addEventListener('pointerup',onPointerUp);
}
function onMarqueeMove(ev) {
  if (!state.marquee) return;
  state.marquee.end = stagePoint(ev.clientX, ev.clientY);
  updateMarqueeEl(state.marquee.start, state.marquee.end);
}
function onMarqueeUp(ev) {
  window.removeEventListener('pointermove', onMarqueeMove);
  window.removeEventListener('pointerup', onMarqueeUp);
  finishMarquee(state.marquee && state.marquee.add);
}
function onPointerMove(ev) {
  if (!state.drag) return;
  const drag=state.drag, obj=getObject(drag.id); if (!obj) return;
  let ptr=stagePoint(ev.clientX,ev.clientY), dx=ptr.x-drag.startPtr.x, dy=ptr.y-drag.startPtr.y;
  if (ev.altKey && !drag.handle) {
    if (drag.axis == null) drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (drag.axis === 'x') dy = 0; else dx = 0;
  } else {
    drag.axis = null;
  }
  if (!drag.moved && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || drag.handle)) {
    drag.moved = true;
    if (!drag.historyPushed) { pushHistory(); drag.historyPushed = true; }
  }
  if (drag.handle) {
    clearGuides();
    if (drag.handle === 'rotate') {
      const box = drag.startBox;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const ang = Math.atan2(ptr.y - cy, ptr.x - cx) * 180 / Math.PI;
      obj.rotation = nearestRightAngle(ang + 90);
    } else {
      resizeObject(drag,dx,dy,obj,ev);
    }
  } else if (drag.groupIds && drag.groupIds.length > 1 && drag.starts) {
    clearGuides();
    drag.groupIds.forEach(sid => {
      const o = getObject(sid); const st = drag.starts[sid];
      if (!o || !st) return;
      if (o.id==='serial' || o.centerX!=null) {
        o.centerX = snapPx(st.centerX+dx,'x');
        o.y = snapPx(st.y+dy,'y');
      } else {
        o.x = snapPx(st.x+dx,'x');
        o.y = snapPx(st.y+dy,'y');
      }
    });
  } else {
    let nx, ny;
    if (obj.id==='serial' || obj.centerX!=null) {
      nx = snapPx(drag.startObj.centerX+dx,'x');
      ny = snapPx(drag.startObj.y+dy,'y');
      const snapped = smartSnapMove(obj, nx, ny);
      obj.centerX = snapped.x; obj.y = snapped.y;
      drawGuides(snapped.lines);
    } else {
      nx = snapPx(drag.startObj.x+dx,'x');
      ny = snapPx(drag.startObj.y+dy,'y');
      const snapped = smartSnapMove(obj, nx, ny);
      if (obj.type === 'line') {
        const ox = snapped.x - num(drag.startObj.x, 0);
        const oy = snapped.y - num(drag.startObj.y, 0);
        obj.x = snapped.x; obj.y = snapped.y;
        obj.x2 = num(drag.startObj.x2, drag.startObj.x + num(drag.startObj.w, 0)) + ox;
        obj.y2 = num(drag.startObj.y2, drag.startObj.y) + oy;
        obj.w = obj.x2 - obj.x; obj.h = obj.y2 - obj.y;
      } else {
        obj.x = snapped.x; obj.y = snapped.y;
      }
      drawGuides(snapped.lines);
    }
  }
  syncDynamicFields(); renderObjects();
}
function resizeObject(drag,dx,dy,obj,ev) {
  const h=drag.handle, b=drag.startBox;
  if (obj.type==='qr') {
    const bt = String(obj.barcodeType||'qr').toLowerCase();
    if (bt === 'code128' || bt === 'c128') {
      if (h.includes('e')) obj.w=Math.max(30,b.w+dx);
      if (h.includes('w')) { obj.w=Math.max(30,b.w-dx); obj.x=snapPx(b.x+dx,'x'); }
      if (h.includes('s')) obj.h=Math.max(20,b.h+dy);
      if (h.includes('n')) { obj.h=Math.max(20,b.h-dy); obj.y=snapPx(b.y+dy,'y'); }
      obj.size = obj.w;
      return;
    }
    obj.size=Math.max(30,b.w+Math.max(dx,dy)); return;
  }
  if (obj.type==='image' || obj.type==='box') {
    const lock = !!obj.lockAspect || !!(ev && ev.shiftKey);
    const ratio = (b.h > 0) ? (b.w / b.h) : 1;
    if (h.includes('e')) obj.w=Math.max(10,b.w+dx);
    if (h.includes('w')) { obj.w=Math.max(10,b.w-dx); obj.x=snapPx(b.x+dx,'x'); }
    if (h.includes('s')) obj.h=Math.max(10,b.h+dy);
    if (h.includes('n')) { obj.h=Math.max(10,b.h-dy); obj.y=snapPx(b.y+dy,'y'); }
    if (lock && (h.includes('e') || h.includes('w'))) obj.h = Math.max(10, obj.w / Math.max(0.01, ratio));
    else if (lock && (h.includes('n') || h.includes('s'))) obj.w = Math.max(10, obj.h * ratio);
    return;
  }
  if (obj.type==='line') {
    // Resize by moving endpoint x2/y2 via SE/E/S handles, or origin via NW
    if (h === 'se' || h === 'e' || h === 's') {
      obj.x2 = num(b.x2, b.x + b.w) + dx;
      obj.y2 = num(b.y2, b.y) + dy;
    } else if (h === 'nw' || h === 'w' || h === 'n') {
      obj.x = snapPx(num(b.x1, b.x) + dx, 'x');
      obj.y = snapPx(num(b.y1, b.y) + dy, 'y');
      obj.x2 = num(b.x2, b.x + b.w);
      obj.y2 = num(b.y2, b.y);
    }
    obj.w = obj.x2 - obj.x; obj.h = obj.y2 - obj.y;
    return;
  }
  if (h.includes('e')) obj.w=Math.max(30,b.w+dx);
  if (h.includes('w')) { obj.w=Math.max(30,b.w-dx); obj.x=snapPx(b.x+dx,'x'); }
  if (obj.centerX!=null) obj.centerX=obj.x+obj.w/2;
}
function onPointerUp() {
  if (state.drag) {
    const moved = !!state.drag.moved;
    state.drag=null;
    clearGuides();
    if (moved) {
      syncDynamicFields();
      schedulePreview();
      updateDirtyUi();
    }
  }
  window.removeEventListener('pointermove',onPointerMove); window.removeEventListener('pointerup',onPointerUp);
}
function addTextObject() {
  mutate(()=>{
    const id=newId('text');
    state.document.editorObjects.push({
      id, type:'text', name:id, label:T.newText, dataField:'specLine1', bartenderField:'SpecLine1',
      x:mmToPxX(5), y:mmToPxY(5), w:mmToPxX(40), fontPt:4.2, fontFamily:'DejaVu Sans', bold:false, align:'left',
      rotation:0, locked:false, visible:true, deletable:true, zIndex:nextZ(),
    });
    setSelection([id], id);
  });
  setStatus(T.added,'success');
}
function addQrObject() {
  mutate(()=>{
    const id=newId('qr');
    state.document.editorObjects.push({
      id, type:'qr', name:'QR Code', label:T.qrtype, dataField:'serial', bartenderField:'Serial',
      barcodeType:'qr', x:mmToPxX(40), y:mmToPxY(2), size:mmToPxX(14), locked:false, visible:true, deletable:true, zIndex:nextZ(),
    });
    setSelection([id], id);
  });
  setStatus(T.added,'success');
}
function addLineObject() {
  mutate(()=>{
    const id=newId('line');
    const x=mmToPxX(4), y=mmToPxY(10), x2=mmToPxX(30), y2=y;
    state.document.editorObjects.push({
      id, type:'line', name:id, label:T.addLine, x, y, x2, y2, w:x2-x, h:0, strokeWidth:2,
      locked:false, visible:true, deletable:true, zIndex:nextZ(),
    });
    setSelection([id], id);
  });
  setStatus(T.added,'success');
}
function addBoxObject() {
  mutate(()=>{
    const id=newId('box');
    state.document.editorObjects.push({
      id, type:'box', name:id, label:T.addBox, x:mmToPxX(2), y:mmToPxY(2), w:mmToPxX(20), h:mmToPxY(8),
      strokeWidth:2, filled:false, rotation:0, locked:false, visible:true, deletable:true, zIndex:nextZ(),
    });
    setSelection([id], id);
  });
  setStatus(T.added,'success');
}
function openAddImagePicker() {
  if (els.addImageFile) { els.addImageFile.value=''; els.addImageFile.click(); }
}
function onAddImageFile() {
  const f = els.addImageFile && els.addImageFile.files && els.addImageFile.files[0];
  if (f) pasteExternalImageBlob(f);
}
function deleteSelected() {
  const objs = getSelectedObjects();
  if (!objs.length) return;
  const protectedOnes = objs.filter(o => o.deletable === false);
  const removable = objs.filter(o => o.deletable !== false);
  if (!removable.length) { setStatus(T.cannotDel,'warning'); return; }
  const ids = new Set(removable.map(o => o.id));
  mutate(()=>{
    state.document.editorObjects = editorObjects().filter(o=>!ids.has(o.id));
    clearSelection();
  });
  setStatus(protectedOnes.length ? T.deletedN + removable.length : T.deleted, 'secondary');
}
function duplicateSelected() {
  const objs = getSelectedObjects().filter(o => o.type !== 'static');
  if (!objs.length) return;
  mutate(()=>{
    const newIds = [];
    objs.forEach(obj => {
      const copy=deepClone(obj); copy.id=newId(obj.type); copy.name=copy.id; copy.label=(obj.label||obj.name)+' (2)';
      copy.deletable=true; copy.zIndex=nextZ(); copy.x=num(copy.x,0)+20; copy.y=num(copy.y,0)+20;
      if (copy.centerX!=null) copy.centerX=num(copy.centerX,0)+20;
      state.document.editorObjects.push(copy);
      newIds.push(copy.id);
    });
    setSelection(newIds, newIds[newIds.length-1]);
  });
}

function isFormFieldTarget(el) {
  return !!(el && el.closest && el.closest('input,textarea,select,[contenteditable="true"]'));
}

function scaleImageToLabel(nw, nh) {
  const maxW = docRefW() * 0.75;
  const maxH = docRefH() * 0.75;
  const s = Math.min(1, maxW / Math.max(1, nw), maxH / Math.max(1, nh));
  return { w: Math.max(20, Math.round(nw * s)), h: Math.max(20, Math.round(nh * s)) };
}
function optimizePngDataUrl(img) {
  const maxBytes = 450000;
  let w = img.naturalWidth || 100;
  let h = img.naturalHeight || 100;
  const scaled = scaleImageToLabel(w, h);
  w = scaled.w; h = scaled.h;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let dataUrl = '';
  for (let i = 0; i < 6; i++) {
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length <= maxBytes) break;
    w = Math.max(20, Math.round(w * 0.82));
    h = Math.max(20, Math.round(h * 0.82));
  }
  return { dataUrl, w, h };
}
function pasteExternalImageBlob(blob) {
  if (!blob || !state.document) return;
  const reader = new FileReader();
  reader.onerror = () => setStatus(T.pasteImgErr, 'danger');
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => setStatus(T.pasteImgErr, 'danger');
    img.onload = () => {
      const { dataUrl, w, h } = optimizePngDataUrl(img);
      mutate(() => {
        const id = newId('img');
        state.document.editorObjects.push({
          id, type: 'image', name: id, label: T.image,
          x: mmToPxX(5), y: mmToPxY(5), w, h,
          imageData: dataUrl,
          locked: false, visible: true, deletable: true, zIndex: nextZ(),
        });
        setSelection([id], id);
      });
      setStatus(T.pasteImgOk, 'success');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(blob);
}

function pasteExternalText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) { setStatus(T.pasteExtEmpty, 'warning'); return; }
  const obj = getObject(state.selectedId);
  mutate(() => {
    if (obj && obj.type === 'text' && !obj.locked) {
      obj.fixedText = text;
      return;
    }
    const id = newId('text');
    const preview = text.split('\n')[0].trim().slice(0, 40) || T.newText;
    const estMm = Math.max(15, Math.min(docPageW() - 4, preview.length * 1.4 + 4));
    state.document.editorObjects.push({
      id, type: 'text', name: id, label: preview, dataField: '', fixedText: text, bartenderField: 'Text',
      x: mmToPxX(5), y: mmToPxY(5), w: mmToPxX(estMm), fontPt: 4.2, fontFamily: 'DejaVu Sans', bold: false, align: 'left',
      rotation: 0, locked: false, visible: true, deletable: true, zIndex: nextZ(),
    });
    setSelection([id], id);
  });
  setStatus(T.pasteExtOk, 'success');
}
function onPaste(ev) {
  if (isFormFieldTarget(ev.target)) return;
  const cd = ev.clipboardData;
  if (!cd) return;
  const items = cd.items ? Array.from(cd.items) : [];
  for (const item of items) {
    if (item.type && item.type.indexOf('image/') === 0) {
      ev.preventDefault();
      pasteExternalImageBlob(item.getAsFile());
      return;
    }
  }
  const text = cd.getData('text/plain');
  if (text == null || text === '') return;
  ev.preventDefault();
  pasteExternalText(text);
}

function copySelected() {
  const objs = getSelectedObjects().filter(o => o.type !== 'static');
  if (!objs.length) return;
  state.clipboard = objs.length === 1 ? deepClone(objs[0]) : objs.map(o => deepClone(o));
}
function pasteClipboard() {
  if (!state.clipboard) { setStatus(T.clipboardEmpty,'warning'); return; }
  mutate(()=>{
    const items = Array.isArray(state.clipboard) ? state.clipboard : [state.clipboard];
    const newIds = [];
    items.forEach(src => {
      const copy=deepClone(src); copy.id=newId(copy.type||'text'); copy.name=copy.id; copy.deletable=true;
      copy.zIndex=nextZ(); copy.x=num(copy.x,0)+15; copy.y=num(copy.y,0)+15;
      if (copy.centerX!=null) copy.centerX=num(copy.centerX,0)+15;
      state.document.editorObjects.push(copy);
      newIds.push(copy.id);
    });
    setSelection(newIds, newIds[newIds.length-1]);
  });
}
function toggleLock() {
  const objs = getSelectedObjects();
  if (!objs.length) return;
  mutate(()=>{ objs.forEach(obj => { obj.locked = !obj.locked; }); });
}
function toggleVisible() {
  const objs = getSelectedObjects();
  if (!objs.length) return;
  mutate(()=>{ objs.forEach(obj => { obj.visible = obj.visible===false; }); });
}
function zOrder(delta) {
  const objs = getSelectedObjects();
  if (!objs.length) return;
  mutate(()=>{ objs.forEach(obj => { obj.zIndex = Math.max(0, num(obj.zIndex,0) + delta); }); });
}
function bringToFront() {
  const objs = getSelectedObjects();
  if (!objs.length) return;
  mutate(() => {
    let z = Math.max(0, ...editorObjects().map(o => num(o.zIndex, 0)));
    objs.forEach(obj => { z += 10; obj.zIndex = z; });
  });
}
function sendToBack() {
  const objs = getSelectedObjects();
  if (!objs.length) return;
  mutate(() => {
    const others = editorObjects().filter(o => !selectedList().includes(o.id));
    let z = 10;
    others.forEach(o => { o.zIndex = z; z += 10; });
    objs.forEach(obj => { obj.zIndex = 0; });
  });
}
function matchSizeToPrimary() {
  const primary = getObject(state.selectedId);
  const objs = getSelectedObjects().filter(o => o.id !== state.selectedId && !o.locked);
  if (!primary || objs.length < 1) { setStatus(T.matchNeed, 'warning'); return; }
  const box = objectBox(primary); if (!box) return;
  mutate(() => {
    objs.forEach(obj => {
      if (obj.type === 'qr' && primary.type === 'qr') obj.size = num(primary.size, box.w);
      else if (obj.type === 'image' && primary.type === 'image') { obj.w = box.w; obj.h = box.h; }
      else if (obj.type === 'text' || obj.type === primary.type) {
        obj.w = box.w;
        if (primary.type === 'text' && obj.type === 'text') {
          if (num(primary.fontMm, 0) > 0) { obj.fontMm = primary.fontMm; obj.fontPt = fontPtFromMm(primary.fontMm); }
          else if (primary.fontPt != null) { obj.fontPt = primary.fontPt; obj.fontMm = fontMmFromPt(primary.fontPt); }
          if (primary.bold != null) obj.bold = !!primary.bold;
        }
      }
    });
  });
  setStatus(T.matchOk, 'success');
}
function matchDimension(dim) {
  const primary = getObject(state.selectedId);
  const objs = getSelectedObjects().filter(o => o.id !== state.selectedId && !o.locked);
  if (!primary || objs.length < 1) { setStatus(T.matchNeed, 'warning'); return; }
  const box = objectBox(primary); if (!box) return;
  mutate(() => {
    objs.forEach(obj => {
      if (dim === 'w') {
        if (obj.type === 'qr') obj.size = box.w;
        else obj.w = box.w;
      } else if (dim === 'h') {
        if (obj.type === 'qr') obj.size = box.h;
        else if (obj.type === 'image') obj.h = box.h;
      }
    });
  });
  setStatus(dim === 'w' ? T.sameW : T.sameH, 'success');
}
function centerSelectionOnLabel() {
  const objs = getSelectedObjects().filter(o => !o.locked);
  if (!objs.length) return;
  const bounds = selectionBounds(objs); if (!bounds) return;
  const dx = docRefW() / 2 - bounds.cx;
  const dy = docRefH() / 2 - bounds.cy;
  mutate(() => {
    objs.forEach(obj => {
      if (obj.id === 'serial' || obj.centerX != null) {
        obj.centerX = num(obj.centerX, 0) + dx;
        obj.y = num(obj.y, 0) + dy;
      } else {
        obj.x = num(obj.x, 0) + dx;
        obj.y = num(obj.y, 0) + dy;
      }
    });
  });
  setStatus(T.centerLabel, 'success');
}
function renameSelected() {
  const obj = getObject(state.selectedId);
  if (!obj || obj.type === 'static') return;
  const next = window.prompt(T.renamePrompt, obj.label || obj.name || obj.id);
  if (next == null) return;
  const label = String(next).trim();
  if (!label) return;
  mutate(() => { obj.label = label; });
}
function ensureSelectionVisible() {
  const id = state.selectedId;
  if (!id || !els.canvasScroll || !els.objects) return;
  const el = els.objects.querySelector('.bt-obj[data-id="' + id + '"]');
  if (!el) return;
  try { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch (_e) {}
  const li = els.objList && els.objList.querySelector('.bt-obj-item[data-obj-id="' + id + '"]');
  if (li) { try { li.scrollIntoView({ block: 'nearest' }); } catch (_e2) {} }
}
function panelLayoutStorageKey() { return 'nameplate-editor-panels-v1'; }
function loadPanelLayout() {
  try {
    const raw = localStorage.getItem(panelLayoutStorageKey());
    if (!raw) return { left: true, right: true };
    const data = JSON.parse(raw);
    return { left: data.left !== false, right: data.right !== false };
  } catch (_e) {
    return { left: true, right: true };
  }
}
function savePanelLayout() {
  if (!els.app) return;
  try {
    localStorage.setItem(panelLayoutStorageKey(), JSON.stringify({
      left: !els.app.classList.contains('is-left-collapsed'),
      right: !els.app.classList.contains('is-right-collapsed'),
    }));
  } catch (_e) {}
}
function applyPanelLayout(layout) {
  if (!els.app) return;
  const L = layout || loadPanelLayout();
  els.app.classList.toggle('is-left-collapsed', !L.left);
  els.app.classList.toggle('is-right-collapsed', !L.right);
  savePanelLayout();
  requestAnimationFrame(() => { drawRulers(); });
}
function setPanelCollapsed(side, collapsed) {
  if (!els.app) return;
  els.app.classList.toggle(side === 'left' ? 'is-left-collapsed' : 'is-right-collapsed', !!collapsed);
  savePanelLayout();
  requestAnimationFrame(() => { drawRulers(); zoomFit(); });
}
function updatePageSizeBadges() {
  const label = docPageW().toFixed(0) + '\u00d7' + docPageH().toFixed(0) + ' \u043c\u043c';
  if (els.workspaceSize) els.workspaceSize.textContent = label;
  if (els.pageSizeBadge) els.pageSizeBadge.textContent = label;
}

async function refreshAgentStatus() {
  if (!els.agentStatus) return;
  const url = 'http://127.0.0.1:18778/health';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const resp = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    clearTimeout(t);
    state.agentOk = !!(resp && resp.ok);
  } catch (_e) {
    state.agentOk = false;
  }
  els.agentStatus.classList.toggle('is-online', state.agentOk === true);
  els.agentStatus.classList.toggle('is-offline', state.agentOk === false);
  els.agentStatus.title = state.agentOk ? T.agentOnline : T.agentOffline;
  els.agentStatus.innerHTML = state.agentOk
    ? '<i class="bi bi-printer-fill"></i> агент'
    : '<i class="bi bi-printer"></i> агент';
}
function copyStyle() {
  const obj = getObject(state.selectedId);
  if (!obj || obj.type === 'static') return;
  state.styleClipboard = {
    type: obj.type,
    fontMm: obj.fontMm, fontPt: obj.fontPt, bold: !!obj.bold, align: obj.align || 'left',
    size: obj.size, w: obj.w, h: obj.h, rotation: obj.rotation,
    barcodeType: obj.barcodeType,
  };
  setStatus(T.styleCopied, 'success');
}
function pasteStyle() {
  const style = state.styleClipboard;
  if (!style) { setStatus(T.styleEmpty, 'warning'); return; }
  const objs = getSelectedObjects().filter(o => !o.locked);
  if (!objs.length) return;
  mutate(() => {
    objs.forEach(obj => {
      if (obj.type === 'text' && (style.type === 'text' || style.fontPt != null || style.fontMm != null)) {
        if (num(style.fontMm, 0) > 0) { obj.fontMm = style.fontMm; obj.fontPt = fontPtFromMm(style.fontMm); }
        else if (style.fontPt != null) { obj.fontPt = style.fontPt; obj.fontMm = fontMmFromPt(style.fontPt); }
        obj.bold = !!style.bold;
        if (style.align) obj.align = style.align;
        if (style.rotation != null) obj.rotation = style.rotation;
      }
      if (obj.type === 'qr' && style.type === 'qr') {
        if (style.size != null) obj.size = style.size;
        if (style.barcodeType) obj.barcodeType = style.barcodeType;
      }
      if (obj.type === 'image' && style.type === 'image') {
        if (style.w != null) obj.w = style.w;
        if (style.h != null) obj.h = style.h;
      }
    });
  });
  setStatus(T.stylePasted, 'success');
}
function fitTextWidth() {
  const obj = getObject(state.selectedId);
  if (!obj || obj.type !== 'text' || obj.locked) return;
  const text = String(sampleText(obj) || '').split('\n')[0] || ' ';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const px = fontPxForObj(obj);
  ctx.font = (obj.bold ? '700 ' : '400 ') + px + 'px ' + (obj.mono || obj.id === 'serial' ? 'Consolas, monospace' : 'Arial, Helvetica, sans-serif');
  const w = Math.ceil(ctx.measureText(text).width) + mmToPxX(0.4);
  mutate(() => {
    obj.w = Math.max(mmToPxX(4), w);
    if (obj.centerX != null) obj.centerX = num(obj.x, obj.centerX - obj.w / 2) + obj.w / 2;
  });
  setStatus(T.fitTextOk, 'success');
}
function renderPinnedGuides() {
  if (!els.pinnedGuides) return;
  const z = state.zoom;
  els.pinnedGuides.innerHTML = '';
  (state.pinnedGuides || []).forEach(g => {
    const el = document.createElement('div');
    if (g.axis === 'v') {
      el.className = 'bt-pinned-v';
      el.style.left = (mmToPxX(g.mm) * z) + 'px';
    } else {
      el.className = 'bt-pinned-h';
      el.style.top = (mmToPxY(g.mm) * z) + 'px';
    }
    els.pinnedGuides.appendChild(el);
  });
}
function clearPinnedGuides() {
  state.pinnedGuides = [];
  renderPinnedGuides();
  setStatus(T.guidesCleared, 'secondary');
}
function pinGuideFromRuler(ev, axis) {
  if (!els.labelStage) return;
  const stage = els.labelStage.getBoundingClientRect();
  let mm;
  if (axis === 'v') {
    const xPx = (ev.clientX - stage.left) / state.zoom;
    mm = Math.round(pxToMmX(xPx) * 10) / 10;
    if (mm < 0 || mm > docPageW()) return;
  } else {
    const yPx = (ev.clientY - stage.top) / state.zoom;
    mm = Math.round(pxToMmY(yPx) * 10) / 10;
    if (mm < 0 || mm > docPageH()) return;
  }
  // toggle near existing
  const near = (state.pinnedGuides || []).findIndex(g => g.axis === axis && Math.abs(g.mm - mm) < 0.15);
  if (near >= 0) state.pinnedGuides.splice(near, 1);
  else state.pinnedGuides.push({ axis, mm });
  renderPinnedGuides();
  setStatus(T.guidePinned + ' ' + mm.toFixed(1) + ' мм', 'success');
}
function onObjectHover(ev) {
  const objEl = ev.target.closest('.bt-obj');
  const id = objEl ? objEl.dataset.id : null;
  if (id === state.hoverId) return;
  state.hoverId = id;
  els.objects.querySelectorAll('.bt-obj.is-hover').forEach(n => n.classList.remove('is-hover'));
  if (objEl) objEl.classList.add('is-hover');
}
/** Place dragged layer above target in the visible (top-first) list. */
function reorderLayer(fromId, toId) {
  const objs = editorObjects();
  const from = objs.find(o => o.id === fromId);
  const to = objs.find(o => o.id === toId);
  if (!from || !to) return;
  mutate(() => {
    const ordered = sortedObjects().slice().reverse(); // top -> bottom as in UI
    const fi = ordered.findIndex(o => o.id === fromId);
    const ti = ordered.findIndex(o => o.id === toId);
    if (fi < 0 || ti < 0 || fi === ti) return;
    const [item] = ordered.splice(fi, 1);
    ordered.splice(ti, 0, item);
    // Higher z = closer to top of stack / first in UI list
    const n = ordered.length;
    ordered.forEach((o, i) => { o.zIndex = (n - i) * 10; });
    setSelection([fromId], fromId);
  });
}
function selectionBounds(objs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objs.forEach(obj => {
    const box = objectBox(obj); if (!box) return;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  });
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
function setObjX(obj, x) {
  const box = objectBox(obj); if (!box) return;
  if (obj.id === 'serial' || obj.centerX != null) {
    obj.centerX = x + box.w / 2;
    obj.x = x;
  } else {
    obj.x = x;
  }
}
function setObjY(obj, y) {
  obj.y = y;
}
function alignSelected(mode) {
  const objs = getSelectedObjects().filter(o => !o.locked);
  if (!objs.length) return;
  mutate(()=>{
    if (objs.length === 1) {
      const obj = objs[0];
      const box = objectBox(obj); if (!box) return;
      if (mode==='left') setObjX(obj, mmToPxX(2));
      else if (mode==='right') setObjX(obj, docRefW()-box.w-mmToPxX(2));
      else if (mode==='centerX') { obj.centerX=docRefW()/2; obj.align='center'; obj.w=num(obj.w,box.w); obj.x=obj.centerX-obj.w/2; }
      else if (mode==='top') setObjY(obj, mmToPxY(2));
      else if (mode==='bottom') setObjY(obj, docRefH()-lineHeightPx(obj)-mmToPxY(2));
      else if (mode==='middle') setObjY(obj, (docRefH()-lineHeightPx(obj))/2);
      return;
    }
    const bounds = selectionBounds(objs); if (!bounds) return;
    objs.forEach(obj => {
      const box = objectBox(obj); if (!box) return;
      if (mode==='left') setObjX(obj, bounds.x);
      else if (mode==='right') setObjX(obj, bounds.x + bounds.w - box.w);
      else if (mode==='centerX') setObjX(obj, bounds.cx - box.w / 2);
      else if (mode==='top') setObjY(obj, bounds.y);
      else if (mode==='bottom') setObjY(obj, bounds.y + bounds.h - box.h);
      else if (mode==='middle') setObjY(obj, bounds.cy - box.h / 2);
    });
  });
}
function distributeSelected(axis) {
  const objs = getSelectedObjects().filter(o => !o.locked);
  if (objs.length < 3) { setStatus(T.distNeed, 'warning'); return; }
  mutate(() => {
    const withBox = objs.map(o => ({ o, box: objectBox(o) })).filter(x => x.box);
    if (withBox.length < 3) return;
    if (axis === 'h') {
      withBox.sort((a, b) => a.box.x - b.box.x);
      const first = withBox[0].box.x;
      const last = withBox[withBox.length - 1].box.x + withBox[withBox.length - 1].box.w;
      const totalW = withBox.reduce((s, x) => s + x.box.w, 0);
      const gap = (last - first - totalW) / (withBox.length - 1);
      let x = first;
      withBox.forEach((item, i) => {
        if (i === 0) { x = item.box.x + item.box.w; return; }
        if (i === withBox.length - 1) return;
        setObjX(item.o, x + gap);
        x = x + gap + item.box.w;
      });
    } else {
      withBox.sort((a, b) => a.box.y - b.box.y);
      const first = withBox[0].box.y;
      const last = withBox[withBox.length - 1].box.y + withBox[withBox.length - 1].box.h;
      const totalH = withBox.reduce((s, x) => s + x.box.h, 0);
      const gap = (last - first - totalH) / (withBox.length - 1);
      let y = first;
      withBox.forEach((item, i) => {
        if (i === 0) { y = item.box.y + item.box.h; return; }
        if (i === withBox.length - 1) return;
        setObjY(item.o, y + gap);
        y = y + gap + item.box.h;
      });
    }
  });
  setStatus(T.distOk, 'success');
}
function openHelpModal() {
  const el = $('btHelpModal');
  if (!el || typeof bootstrap === 'undefined') return;
  bootstrap.Modal.getOrCreateInstance(el).show();
}
function isTypingTarget(ev) {
  return !!ev.target.closest('input,textarea,select,[contenteditable="true"]');
}
function cycleSelection(backward) {
  const list = sortedObjects().filter(o => o && o.type !== 'static');
  if (!list.length) return;
  let idx = list.findIndex(o => o.id === state.selectedId);
  if (idx < 0) idx = backward ? 0 : -1;
  idx = backward ? (idx - 1 + list.length) % list.length : (idx + 1) % list.length;
  selectObject(list[idx].id);
}
function onKeyDown(ev) {
  const mod = ev.ctrlKey || ev.metaKey;
  const typing = isTypingTarget(ev);

  if (ev.code === 'Space' && !typing && !mod) {
    if (!state.spaceDown) {
      state.spaceDown = true;
      if (els.canvasScroll) els.canvasScroll.classList.add('can-pan');
    }
    ev.preventDefault();
    return;
  }

  if (ev.key === 'Escape' && !typing) {
    ev.preventDefault();
    hideCtxMenu();
    hideMarquee();
    state.marquee = null;
    clearSelection();
    renderObjects();
    return;
  }
  if (ev.key === 'F2' && !typing) { ev.preventDefault(); renameSelected(); return; }
  if (ev.key === 'F1') { ev.preventDefault(); openHelpModal(); return; }
  if (!typing && !mod && (ev.key === '?' || (ev.shiftKey && ev.key === '/'))) { ev.preventDefault(); openHelpModal(); return; }
  if (!typing && !mod && (ev.key === 'g' || ev.key === 'G')) {
    ev.preventDefault();
    if (els.showGrid) { els.showGrid.checked = !els.showGrid.checked; updateGrid(); }
    return;
  }
  if (!typing && !mod && (ev.key === 'm' || ev.key === 'M')) {
    ev.preventDefault();
    if (els.showMargins) {
      els.showMargins.checked = !els.showMargins.checked;
      layoutSettings().showMarginGuides = els.showMargins.checked;
      renderMarginGuides();
    }
    return;
  }
  if (ev.key === 'Tab' && !typing && !mod) {
    ev.preventDefault();
    cycleSelection(ev.shiftKey);
    return;
  }

  if (mod && ev.key==='s') { ev.preventDefault(); saveTemplate(); return; }
  if (mod && ev.key.toLowerCase()==='a' && !typing) { ev.preventDefault(); selectAllObjects(); return; }
  if (typing) return; // keep native undo/copy/paste inside fields

  if (mod && ev.key==='z' && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
  if ((mod && ev.key==='y') || (mod && ev.shiftKey && ev.key==='z')) { ev.preventDefault(); redo(); return; }
  if (mod && ev.key==='c') { ev.preventDefault(); copySelected(); return; }
  if (mod && ev.key==='v' && ev.shiftKey) { ev.preventDefault(); pasteClipboard(); return; }
  if (mod && ev.key==='d') { ev.preventDefault(); duplicateSelected(); return; }
  if (mod && (ev.key==='=' || ev.key==='+' || ev.code==='Equal')) { ev.preventDefault(); state.zoom=Math.min(3,Math.round((state.zoom+0.1)*10)/10); applyZoom(); return; }
  if (mod && (ev.key==='-' || ev.code==='Minus')) { ev.preventDefault(); state.zoom=Math.max(0.25,Math.round((state.zoom-0.1)*10)/10); applyZoom(); return; }
  if (mod && ev.key==='0') { ev.preventDefault(); zoomFit(); return; }
  if (ev.key===']' && !mod) { ev.preventDefault(); zOrder(10); return; }
  if (ev.key==='[' && !mod) { ev.preventDefault(); zOrder(-10); return; }
  if (ev.key===']' && mod && ev.shiftKey) { ev.preventDefault(); bringToFront(); return; }
  if (ev.key==='[' && mod && ev.shiftKey) { ev.preventDefault(); sendToBack(); return; }
  if (mod && ev.altKey && ev.key.toLowerCase()==='c') { ev.preventDefault(); copyStyle(); return; }
  if (mod && ev.altKey && ev.key.toLowerCase()==='v') { ev.preventDefault(); pasteStyle(); return; }
  if (mod && ev.shiftKey && (ev.key === 'Enter' || ev.code === 'Enter')) { ev.preventDefault(); centerSelectionOnLabel(); return; }
  if (mod && ev.key.toLowerCase()==='e') {
    ev.preventDefault();
    if (els.showOverlay) { els.showOverlay.checked = !els.showOverlay.checked; void onOverlayToggle(); }
    return;
  }
  if (!typing && !mod && (ev.key === 'e' || ev.key === 'E')) {
    ev.preventDefault();
    if (els.showOverlay) { els.showOverlay.checked = !els.showOverlay.checked; void onOverlayToggle(); }
    return;
  }
  if (ev.key==='Delete' || ev.key==='Backspace') {
    ev.preventDefault(); deleteSelected(); return;
  }
  if (!selectedList().length) return;
  const stepMm = ev.shiftKey ? 1.0 : (els.snap.checked ? Math.max(0.1, Number(layoutSettings().gridStepMm) || 0.1) : 0.1);
  const stepX = mmToPxX(stepMm);
  const stepY = mmToPxY(stepMm);
  let ok=true;
  if (ev.key==='ArrowLeft' || ev.key==='ArrowRight' || ev.key==='ArrowUp' || ev.key==='ArrowDown') {
    const objs = getSelectedObjects().filter(o => !o.locked);
    if (!objs.length) return;
    if (!state.nudgeTimer) pushHistory();
    objs.forEach(obj => {
      if (ev.key==='ArrowLeft') { obj.id==='serial'||obj.centerX!=null?obj.centerX-=stepX:obj.x-=stepX; }
      else if (ev.key==='ArrowRight') { obj.id==='serial'||obj.centerX!=null?obj.centerX+=stepX:obj.x+=stepX; }
      else if (ev.key==='ArrowUp') obj.y-=stepY;
      else if (ev.key==='ArrowDown') obj.y+=stepY;
    });
    ev.preventDefault();
    syncDynamicFields();
    renderObjects();
    schedulePreview();
    updateDirtyUi();
    if (state.nudgeTimer) clearTimeout(state.nudgeTimer);
    state.nudgeTimer = setTimeout(() => { state.nudgeTimer = null; updateDirtyUi(); }, 400);
    return;
  }
}
function onKeyUp(ev) {
  if (ev.code === 'Space') {
    state.spaceDown = false;
    if (els.canvasScroll) els.canvasScroll.classList.remove('can-pan');
    if (state.pan) {
      state.pan = null;
      if (els.canvasScroll) els.canvasScroll.classList.remove('is-panning');
    }
  }
}
function sampleSerialDefault() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = printKind() === 'complex' ? '400' : '300';
  return prefix + yy + mm + '128';
}

function currentTemplateId() { return state.templateId || state.document?.templateId || 'corrector'; }
function documentsEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hasUnsavedChanges() { return state.document && state.savedDocument && !documentsEqual(state.document, state.savedDocument); }

function currentTemplateMeta() {
  return (state.templates || []).find(t => t.id === currentTemplateId()) || null;
}
function isProtectedTemplate(id) {
  const meta = (state.templates || []).find(t => t.id === id);
  if (meta && meta.protected) return true;
  const k = String(id || '').toLowerCase();
  return k === 'corrector' || k === 'complex';
}
function updateDeleteTemplateButton() {
  if (!els.deleteTemplateBtn) return;
  const protectedTpl = isProtectedTemplate(currentTemplateId());
  els.deleteTemplateBtn.disabled = protectedTpl;
  els.deleteTemplateBtn.title = protectedTpl ? T.deleteTemplateProtected : T.deleteTemplate;
}
async function deleteCurrentTemplate() {
  const id = currentTemplateId();
  if (isProtectedTemplate(id)) { setStatus(T.deleteTemplateProtected, 'warning'); return; }
  const meta = currentTemplateMeta();
  const name = (meta && meta.name) || id;
  const msg = (T.deleteTemplateConfirm || '').replace('{name}', name);
  if (!window.confirm(msg)) return;
  setStatus(T.deleteTemplateBusy, 'secondary');
  const {data} = await fetchJson(API + '?action=delete', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ templateId: id }),
  });
  if (!data.ok) { setStatus(data.error || T.deleteTemplateErr, 'danger'); return; }
  state.templates = data.templates || state.templates;
  const nextId = data.fallbackTemplateId || 'corrector';
  await loadTemplate(nextId);
  setStatus(T.deleteTemplateOk + (data.deleted && data.deleted.filename ? data.deleted.filename : id), 'success');
}

function renderTemplateSelect() {
  if (!els.templateSelect) return;
  const cur = currentTemplateId();
  els.templateSelect.innerHTML = '';
  (state.templates || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name + ' (' + t.pageWidthMm + '\u00d7' + t.pageHeightMm + ' ' + T.mm + ')';
    if (t.id === cur) opt.selected = true;
    els.templateSelect.appendChild(opt);
  });
  updateDeleteTemplateButton();
  renderTemplateGallery();
}
function applyLoadedTemplate(data) {
  state.document = data.document;
  state.savedDocument = deepClone(data.document);
  state.kind = data.kind || 'corrector';
  state.templateId = data.templateId || data.document?.templateId || 'corrector';
  state.templates = data.templates || state.templates || [];
  state.dataSources = data.dataSources || state.dataSources || [];
  state.staticObjects = data.staticObjects || state.staticObjects || [];
  clearSelection();
  state.history = [deepClone(data.document)];
  state.historyIndex = 0;
  updateUndoButtons();
  renderTemplateSelect();
  updateDeleteTemplateButton();
  const blankCanvas = !!(data.blankCanvas || data.document?.blankCanvas || (Array.isArray(data.document?.staticInTemplate) && data.document.staticInTemplate.length === 0));
  if (!blankCanvas && data.previewImageExists) {
    els.labelBg.src = data.previewImageUrl + '&_=' + Date.now();
    els.labelBg.style.display = '';
    if (els.showBg) els.showBg.checked = true;
  } else {
    els.labelBg.removeAttribute('src');
    els.labelBg.style.display = 'none';
    if (els.showBg) els.showBg.checked = false;
  }
  ensureLayoutSettings();
  syncMarginCheckbox();
  updateGrid();
  const name = data.document?.templateName || state.templateId;
  els.templateInfo.innerHTML = '<strong>' + esc(name) + '</strong><br>' + esc(data.pageSize.widthMm + ' \u00d7 ' + data.pageSize.heightMm + ' ' + T.mm) + '<br>' + esc(state.document.refW + ' \u00d7 ' + state.document.refH + ' px') + '<br><span class="text-muted">' + esc(data.referenceBtw || data.fieldsPath || '') + '</span>';
  fillSamples(data.samplePayload || {});
  updatePageSizeBadges();
  updateEmptyTemplateBanner();
  renderTemplateGallery();
  renderFieldsPanel();
  zoomFit();
  updateDirtyUi();
}

function printKind() {
  const k = String(state.document?.productKind || state.kind || state.templateId || 'corrector').toLowerCase();
  return (k === 'complex' || k === '400') ? 'complex' : 'corrector';
}
function sampleProductTitle() {
  if (els.sampleTitle && els.sampleTitle.value.trim()) return els.sampleTitle.value.trim();
  return printKind() === 'complex' ? T.productComplex : T.product;
}
function validSerial(s) { return /^\d{10}$/.test(String(s||'')); }
function buildPayload() {
  const lines=(els.sampleConfig.value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); while(lines.length<3) lines.push('');
  let serial=(els.sampleSerial.value||'').trim();
  if (!validSerial(serial)) serial=sampleSerialDefault();
  return { kind:printKind(), serial:serial, orderNumber:T.order, productTitle:sampleProductTitle(), manufactureDate:new Date().toLocaleDateString('ru-RU'), configText:lines.slice(0,3).join('\n'), releaseLabel:(els.sampleRelease.value||'').trim() };
}
function fillSamples(payload) {
  els.sampleSerial.value=payload.serial||sampleSerialDefault();
  if (els.sampleTitle) {
    els.sampleTitle.value = payload.productTitle || (printKind() === 'complex' ? T.productComplex : T.product);
  }
  if (payload.configText) els.sampleConfig.value=payload.configText;
  const now=new Date(); els.sampleRelease.value=payload.releaseLabel||(T.relSample+String(now.getMonth()+1).padStart(2,'0')+'.'+now.getFullYear());
}
async function loadTemplate(templateId) {
  const id = templateId || currentTemplateId() || 'corrector';
  setStatus(T.load,'secondary');
  const {data} = await fetchJson(API+'?action=load&templateId='+encodeURIComponent(id));
  if (!data.ok) { setStatus(data.error||T.loadErr,'danger'); return; }
  applyLoadedTemplate(data);
  const restored = restoreDraftIfAny(id);
  setStatus(restored ? T.draftRestored : T.loaded, restored ? 'info' : 'success');
  setTimeout(()=>setStatus(''),4000);
  previewPdf();
}
async function saveTemplate() {
  syncDynamicFields(); setStatus(T.save,'secondary');
  if (state.document) state.document.editorVersion = Math.max(3, num(state.document.editorVersion, 2));
  const {data}=await fetchJson(API+'?action=save',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({templateId:currentTemplateId(),kind:state.kind,document:state.document})});
  if (!data.ok) { setStatus(data.error||T.saveErr,'danger'); return; }
  state.savedDocument=deepClone(state.document); if (data.templates) state.templates=data.templates; renderTemplateSelect(); clearDraft(currentTemplateId()); updateDirtyUi(); setStatus(T.saved+data.saved.filename,'success');
}
async function importBtw() {
  const file=state.document.referenceTemplate||'corrector-300.btw'; setStatus(T.imp+file+'\u2026','secondary');
  const {data}=await fetchJson(API+'?action=import-btw',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({btwFile:file,document:state.document})});
  if (!data.ok) { setStatus(data.error||T.impErr,'danger'); return; }
  state.document=data.document; pushHistory(); applyZoom(); schedulePreview(); setStatus(T.impOk+data.source,'success');
}


function clearSampleFields() {
  els.sampleSerial.value = sampleSerialDefault();
  els.sampleConfig.value = '';
  els.sampleRelease.value = '';
  renderObjects();
}
async function clearAllObjects() {
  if (!state.document) return;
  if (!window.confirm(T.clearAllConfirm)) return;
  setStatus(T.clearAll,'secondary');
  const {data} = await fetchJson(API+'?action=clear-all', {
    method:'POST',
    credentials:'same-origin',
    headers:{'Content-Type':'application/json; charset=utf-8'},
    body: JSON.stringify({kind: state.kind, document: state.document}),
  });
  if (!data.ok) { setStatus(data.error||T.clearAllErr,'danger'); return; }
  state.document = data.document;
  clearSelection();
  state.clipboard = null;
  pushHistory();
  clearSampleFields();
  if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
  els.previewFrame.removeAttribute('src');
  applyZoom();
  setStatus(T.clearAllOk,'success');
}

async function applyReferenceLayout() {
  if (!state.document) return;
  if (!window.confirm(T.applyRefConfirm || T.resetZeroConfirm)) return;
  setStatus(T.applyRef,'secondary');
  const {data}=await fetchJson(API+'?action=apply-reference-layout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({kind:state.kind,document:state.document})});
  if (!data.ok) { setStatus(data.error||T.resetZeroErr,'danger'); return; }
  state.document=data.document; clearSelection(); state.clipboard=null; pushHistory();
  applyLoadedTemplate({ ok:true, document:data.document, pageSize:{ widthMm:data.document.pageWidthMm, heightMm:data.document.pageHeightMm }, blankCanvas:true, previewImageExists:false, referenceDrawing:data.referenceDrawing||'' });
  previewPdf();
  setStatus(T.applyRefOk,'success');
}
async function resetToDefaults() {
  return applyReferenceLayout();
}

function resetDoc() {
  if (!state.savedDocument) return;
  state.suppressHistory=true; state.document=deepClone(state.savedDocument); state.suppressHistory=false;
  pushHistory(); applyZoom(); setStatus(T.reset,'secondary'); schedulePreview();
}
async function previewPdf(silent) {
  if (!state.document) return;
  if (state.previewTimer) { clearTimeout(state.previewTimer); state.previewTimer = null; }
  if (state.previewAbort) { try { state.previewAbort.abort(); } catch (_e) {} }
  const ac = new AbortController();
  state.previewAbort = ac;
  syncDynamicFields();
  if (!silent) setStatus(T.genPdf,'secondary');
  setPreviewBusy(true);
  const thermal = !!(els.thermalPreview && els.thermalPreview.checked);
  state.thermalMode = thermal;
  try {
    const body = { kind:printKind(), document:state.document, payload:buildPayload() };
    if (thermal) body.format = 'thermal';
    const res=await fetch(API+'?action=preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body),signal:ac.signal});
    if (ac.signal.aborted) return;
    const ct=(res.headers.get('content-type')||'').toLowerCase();
    if (!res.ok || ct.includes('application/json')) {
      const err=await res.json().catch(()=>({error:'HTTP '+res.status}));
      setStatus(err.error||T.prevErr,'danger'); return;
    }
    const blob = await res.blob();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl=URL.createObjectURL(blob);
    updatePreviewPresentation();
    if (thermal && els.previewThermal) els.previewThermal.src = state.previewUrl;
    else if (els.previewFrame) els.previewFrame.src = state.previewUrl;
    if (!silent) setStatus(T.prevOk,'success');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    setStatus((err && err.message) || T.prevErr, 'danger');
  } finally {
    if (state.previewAbort === ac) state.previewAbort = null;
    setPreviewBusy(false);
  }
}
function collectPrintOverrides(forceSaved) {
  if (forceSaved) return null;
  if (!els.calibDensity) return state.printOverrides;
  return {
    density: Number(els.calibDensity.value),
    speed: Number(els.calibSpeed.value),
    yOffsetMm: Number(els.calibYOffset.value),
    threshold: Number(els.calibThreshold.value),
  };
}
function syncCalibLabels() {
  if (els.calibDensityVal) els.calibDensityVal.textContent = els.calibDensity ? els.calibDensity.value : '';
  if (els.calibSpeedVal) els.calibSpeedVal.textContent = els.calibSpeed ? els.calibSpeed.value : '';
  if (els.calibYOffsetVal) els.calibYOffsetVal.textContent = els.calibYOffset ? els.calibYOffset.value : '';
  if (els.calibThresholdVal) els.calibThresholdVal.textContent = els.calibThreshold ? els.calibThreshold.value : '';
}
function applyCalibToUi(pa) {
  if (!pa) return;
  if (els.calibDensity && pa.density != null) els.calibDensity.value = String(pa.density);
  if (els.calibSpeed && pa.speed != null) els.calibSpeed.value = String(pa.speed);
  if (els.calibYOffset && pa.yOffsetMm != null) els.calibYOffset.value = String(pa.yOffsetMm);
  if (els.calibThreshold && pa.threshold != null) els.calibThreshold.value = String(pa.threshold);
  syncCalibLabels();
}
async function loadPrintCalib() {
  try {
    const { data } = await fetchJson('/api/nameplate-print.php?action=config');
    if (data && data.ok && data.config && data.config.printAgent) applyCalibToUi(data.config.printAgent);
  } catch (_e) {}
}
async function savePrintCalib() {
  const printAgent = collectPrintOverrides(false) || {};
  setStatus(T.save, 'secondary');
  try {
    const { data } = await fetchJson('/api/nameplate-print.php?action=save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ printAgent }),
    });
    if (!(data && data.ok)) throw new Error((data && data.error) || T.calibErr);
    applyCalibToUi(data.printAgent || (data.config && data.config.printAgent));
    setStatus(T.calibSaved, 'success');
  } catch (err) {
    setStatus((err && err.message) || T.calibErr, 'danger');
  }
}
async function printLabel(opts) {
  opts = opts || {};
  if (!state.document) return false;
  syncDynamicFields();
  const payload = Object.assign({}, buildPayload(), opts.payload || {});
  if (opts.serial) payload.serial = opts.serial;
  if (!opts.skipValidate) {
    const issues = validateTemplateForPrint(payload.serial);
    if (issues.length) {
      setStatus(T.validateFail + ': ' + issues[0], 'danger');
      if (!opts.silent) window.alert(T.validateFail + '\n- ' + issues.join('\n- '));
      return false;
    }
  }
  if (!validSerial(payload.serial)) {
    setStatus(T.badSerial, 'danger');
    return false;
  }
  if (!opts.silent) setStatus(T.printLabel, 'secondary');
  try {
    const body = { document: state.document, payload: payload };
    const overrides = opts.printAgent || collectPrintOverrides(!!opts.savedOnly);
    if (overrides) body.printAgent = overrides;
    const { data } = await fetchJson(API + '?action=print', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!data.ok) {
      throw new Error(data.error || T.printErr);
    }
    const config = data.config || (window.TM07_NAMEPLATE && typeof window.TM07_NAMEPLATE.loadConfig === 'function'
      ? await window.TM07_NAMEPLATE.loadConfig(false)
      : null);
    const pa = (config && config.printAgent) || {};
    if (pa.enabled !== false && window.TM07_NAMEPLATE && typeof window.TM07_NAMEPLATE.printViaPrintAgent === 'function') {
      try {
        await window.TM07_NAMEPLATE.printViaPrintAgent(data, config);
        const printer = data.printer || pa.printer || 'TSC TE200';
        if (!opts.silent) setStatus(T.printOk + printer + ' (S/N ' + payload.serial + ')', 'success');
        return true;
      } catch (agentErr) {
        if (pa.fallbackPreview !== false) {
          setStatus((agentErr.message || T.agentOff), 'warning');
          if (!opts.silent) await previewPdf();
          return false;
        }
        throw agentErr;
      }
    }
    if (!opts.silent) await previewPdf();
    setStatus(T.agentOff, 'warning');
    return false;
  } catch (err) {
    setStatus((err && err.message) || T.printErr, 'danger');
    return false;
  }
}
function expandSerialRange(from, to) {
  if (!validSerial(from) || !validSerial(to)) return [];
  if (from.slice(0,7) !== to.slice(0,7)) return [];
  const a = parseInt(from.slice(7), 10), b = parseInt(to.slice(7), 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || (b - a) > 500) return [];
  const prefix = from.slice(0,7), out = [];
  for (let i = a; i <= b; i++) out.push(prefix + String(i).padStart(3,'0'));
  return out;
}
function expandBatchRangeInput() {
  const raw = ((els.batchRange && els.batchRange.value) || '').trim();
  const m = raw.match(/^(\d{10})\s*[-–—]\s*(\d{10})$/);
  if (!m) { setStatus(T.rangeBad, 'warning'); return; }
  const list = expandSerialRange(m[1], m[2]);
  if (!list.length) { setStatus(T.rangeBad, 'warning'); return; }
  if (els.batchSerials) {
    const cur = (els.batchSerials.value || '').trim();
    els.batchSerials.value = (cur ? cur + '\n' : '') + list.join('\n');
  }
  setStatus(T.batchProgress + ' +' + list.length, 'success');
}
function parseBatchSerials() {
  const out = [];
  const rangeRaw = ((els.batchRange && els.batchRange.value) || '').trim();
  const rm = rangeRaw.match(/^(\d{10})\s*[-–—]\s*(\d{10})$/);
  if (rm) expandSerialRange(rm[1], rm[2]).forEach(s => { if (!out.includes(s)) out.push(s); });
  const raw = (els.batchSerials && els.batchSerials.value) || '';
  raw.split(/\r?\n/).forEach(line => {
    const s = String(line || '').trim();
    const mm = s.match(/^(\d{10})\s*[-–—]\s*(\d{10})$/);
    if (mm) expandSerialRange(mm[1], mm[2]).forEach(x => { if (!out.includes(x)) out.push(x); });
    else if (validSerial(s) && !out.includes(s)) out.push(s);
  });
  return out;
}
async function runBatchPrint() {
  if (state.batchRunning) return;
  const list = parseBatchSerials();
  if (!list.length) { setStatus(T.batchEmpty, 'warning'); return; }
  state.batchRunning = true;
  state.batchAbort = false;
  if (els.batchPrint) els.batchPrint.disabled = true;
  if (els.batchStop) els.batchStop.disabled = false;
  let ok = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      if (state.batchAbort) { setStatus(T.batchAbort + ' (' + ok + '/' + list.length + ')', 'warning'); return; }
      const sn = list[i];
      setStatus(T.batchProgress + ' ' + (i + 1) + '/' + list.length + ' · S/N ' + sn, 'secondary');
      const prevSample = els.sampleSerial ? els.sampleSerial.value : '';
      if (els.sampleSerial) els.sampleSerial.value = sn;
      const success = await printLabel({ serial: sn, silent: true, payload: { serial: sn } });
      if (els.sampleSerial) els.sampleSerial.value = prevSample;
      if (!success) {
        setStatus(T.batchFail + sn, 'danger');
        return;
      }
      ok++;
    }
    setStatus(T.batchDone + ': ' + ok, 'success');
  } finally {
    state.batchRunning = false;
    if (els.batchPrint) els.batchPrint.disabled = false;
    if (els.batchStop) els.batchStop.disabled = true;
  }
}
function stopBatchPrint() { state.batchAbort = true; }

function updateEmptyTemplateBanner() {
  const empty = !!(state.document && Array.isArray(state.document.editorObjects) && state.document.editorObjects.length === 0);
  if (els.emptyBanner) els.emptyBanner.classList.toggle('d-none', !empty);
}
function renderTemplateGallery() {
  if (!els.templateGallery) return;
  const cur = currentTemplateId();
  els.templateGallery.innerHTML = '';
  (state.templates || []).forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bt-gallery-card' + (t.id === cur ? ' is-active' : '');
    btn.title = t.name;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = API + '?action=thumbnail&templateId=' + encodeURIComponent(t.id) + '&_=' + (t.updatedAt || Date.now());
    img.onerror = () => { img.style.display = 'none'; };
    const name = document.createElement('div');
    name.className = 'bt-gallery-name';
    name.textContent = t.name;
    const meta = document.createElement('div');
    meta.className = 'text-muted';
    meta.textContent = t.pageWidthMm + '\u00d7' + t.pageHeightMm + ' ' + T.mm;
    btn.appendChild(img); btn.appendChild(name); btn.appendChild(meta);
    btn.onclick = () => { if (t.id !== cur) switchTemplate(t.id); };
    els.templateGallery.appendChild(btn);
  });
}
function renderFieldsPanel() {
  if (!els.fieldsPanel || !state.document) return;
  const dyn = state.document.dynamicFields || {};
  const keys = Object.keys(dyn);
  const bound = {};
  editorObjects().forEach(o => {
    const df = o.dataField || o.id;
    if (df) bound[df] = o.label || o.name || o.id;
  });
  let html = '<div class="fw-semibold mb-1">Поля шаблона</div>';
  if (!keys.length) html += '<div class="text-muted">Нет dynamicFields</div>';
  keys.forEach(k => {
    const src = bound[k];
    html += '<div class="bt-field-row' + (src ? '' : ' is-warn') + '"><span>' + esc(k) + '</span><span>' + esc(src || 'не привязано') + '</span></div>';
  });
  const unboundText = editorObjects().filter(o => o.type === 'text' && !(o.fixedText && String(o.fixedText).trim()) && !o.dataField);
  if (unboundText.length) html += '<div class="is-warn mt-1">Текст без данных: ' + unboundText.length + '</div>';
  els.fieldsPanel.innerHTML = html;
}
function validateTemplateForPrint(serial) {
  const issues = [];
  const sn = String(serial || (els.sampleSerial && els.sampleSerial.value) || '').trim();
  if (!validSerial(sn)) issues.push(T.badSerial);
  const pageW = docRefW(), pageH = docRefH();
  editorObjects().forEach(obj => {
    if (obj.visible === false) return;
    const box = objectBox(obj);
    if (!box) return;
    if (box.x < -2 || box.y < -2 || box.x + box.w > pageW + 2 || box.y + box.h > pageH + 2) {
      issues.push((obj.label || obj.name || obj.id) + ' за пределами этикетки');
    }
    if (obj.type === 'text' && !(obj.fixedText && String(obj.fixedText).trim()) && !obj.dataField && !['specLine1','specLine2','specLine3','releaseLabel','serial','productTitleShort'].includes(obj.id)) {
      issues.push((obj.label || obj.id) + ': нет текста/источника');
    }
    if (obj.type === 'qr') {
      const val = sampleText(obj);
      if (!String(val || '').trim()) issues.push((obj.label || 'QR') + ': пустые данные');
    }
  });
  if (!(state.document && state.document.editorObjects && state.document.editorObjects.length)) {
    issues.push('Нет объектов на этикетке');
  }
  return issues;
}
function groupSelected() {
  const objs = getSelectedObjects();
  if (objs.length < 2) return;
  const gid = newId('grp');
  mutate(() => { objs.forEach(o => { o.groupId = gid; }); });
  setStatus(T.groupOk, 'success');
}
function ungroupSelected() {
  const objs = getSelectedObjects().filter(o => o.groupId);
  if (!objs.length) return;
  mutate(() => { objs.forEach(o => { delete o.groupId; }); });
  setStatus(T.ungroupOk, 'success');
}
async function renameCurrentTemplate() {
  const id = currentTemplateId();
  const meta = currentTemplateMeta();
  const curName = (meta && meta.name) || (state.document && state.document.templateName) || id;
  const name = window.prompt(T.renamePrompt || 'Имя шаблона', curName);
  if (name == null) return;
  const trimmed = String(name).trim();
  if (!trimmed) return;
  let slug = null;
  if (!isProtectedTemplate(id)) {
    const askSlug = window.prompt('Slug файла (пусто = только имя)', id);
    if (askSlug == null) return;
    slug = String(askSlug).trim();
  }
  setStatus(T.save, 'secondary');
  const body = { templateId: id, name: trimmed };
  if (slug && slug !== id) body.slug = slug;
  const { data } = await fetchJson(API + '?action=rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!data.ok) { setStatus(data.error || T.saveErr, 'danger'); return; }
  state.templates = data.templates || state.templates;
  if (data.document) {
    state.document.templateName = data.document.templateName;
    state.document.templateId = data.document.templateId || state.document.templateId;
    state.savedDocument = deepClone(state.document);
  }
  if (data.templateId && data.templateId !== id) {
    state.templateId = data.templateId;
    await loadTemplate(data.templateId);
  } else {
    renderTemplateSelect(); renderTemplateGallery(); updateDeleteTemplateButton();
    const nm = state.document?.templateName || trimmed;
    if (els.templateInfo) els.templateInfo.innerHTML = els.templateInfo.innerHTML.replace(/<strong>[^<]*<\/strong>/, '<strong>' + esc(nm) + '</strong>');
  }
  setStatus(T.renameOk, 'success');
}
async function duplicateCurrentTemplate() {
  const id = currentTemplateId();
  const meta = currentTemplateMeta();
  const def = ((meta && meta.name) || id) + ' (копия)';
  const name = window.prompt('Имя копии', def);
  if (name == null || !String(name).trim()) return;
  setStatus(T.save, 'secondary');
  const { data } = await fetchJson(API + '?action=duplicate', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ templateId: id, name: String(name).trim() }),
  });
  if (!data.ok) { setStatus(data.error || T.saveErr, 'danger'); return; }
  state.templates = data.templates || state.templates;
  setStatus(T.dupTplOk, 'success');
  await loadTemplate(data.templateId);
}
function updatePreviewPresentation() {
  if (!els.previewSplit) return;
  const thermal = !!(els.thermalPreview && els.thermalPreview.checked);
  const side = !!(els.sideBySide && els.sideBySide.checked);
  els.previewSplit.classList.toggle('is-thermal', thermal);
  els.previewSplit.classList.toggle('is-side', side);
  if (side && els.previewRef) {
    els.previewRef.src = API + '?action=reference-overlay&_=' + Date.now();
  }
}
async function downloadPreviewPng() {
  if (!state.document) return;
  syncDynamicFields();
  const thermal = !!(els.thermalPreview && els.thermalPreview.checked);
  setPreviewBusy(true);
  try {
    const body = { kind: printKind(), document: state.document, payload: buildPayload(), format: thermal ? 'thermal' : 'png', download: true };
    const res = await fetch(API + '?action=preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || ct.includes('application/json')) {
      const err = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
      throw new Error(err.error || T.prevErr);
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (buildPayload().serial || 'label') + (thermal ? '-thermal.png' : '.png');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus(T.pngOk, 'success');
  } catch (err) {
    setStatus((err && err.message) || T.prevErr, 'danger');
  } finally {
    setPreviewBusy(false);
  }
}


function zoomFit() {
  if (!state.document) return;
  const pad=80, sw=els.canvasScroll.clientWidth-pad, sh=els.canvasScroll.clientHeight-pad;
  state.zoom=Math.min(2.5,Math.max(0.35,Math.min(sw/docRefW(),sh/docRefH()))); applyZoom();
}

let newTemplateModal = null;
function openNewTemplateModal() {
  if (!els.newModalEl) return;
  els.newName.value = '';
  els.newSlug.value = '';
  els.newWidth.value = String(state.document?.pageWidthMm || 58);
  els.newHeight.value = String(state.document?.pageHeightMm || 20);
  els.newMode.value = 'reference';
  els.newBtw.value = state.document?.referenceTemplate || 'corrector-300.btw';
  newTemplateModal = newTemplateModal || (window.bootstrap ? new bootstrap.Modal(els.newModalEl) : null);
  if (newTemplateModal) newTemplateModal.show();
}
async function createNewTemplate() {
  const name = (els.newName.value || '').trim();
  if (!name) { setStatus(T.newTemplateNameRequired,'warning'); return; }
  setStatus(T.newTemplateCreate,'secondary');
  const body = {
    name,
    slug: (els.newSlug.value || '').trim(),
    pageWidthMm: Number(els.newWidth.value || 58),
    pageHeightMm: Number(els.newHeight.value || 20),
    mode: els.newMode.value || 'blank',
    btwFile: (els.newBtw.value || 'corrector-300.btw').trim(),
    sourceDocument: els.newMode.value === 'copy' ? state.document : null,
  };
  const {data} = await fetchJson(API+'?action=create', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)});
  if (!data.ok) { setStatus(data.error||T.newTemplateErr,'danger'); return; }
  if (newTemplateModal) newTemplateModal.hide();
  await loadTemplate(data.templateId);
  setStatus(T.newTemplateOk + (data.document?.templateName || data.templateId),'success');
}
async function switchTemplate(templateId) {
  if (!templateId || templateId === currentTemplateId()) return;
  if (hasUnsavedChanges() && !window.confirm(T.unsavedSwitch)) {
    renderTemplateSelect();
    return;
  }
  setStatus(T.switchTemplate,'secondary');
  await loadTemplate(templateId);
}


function draftStorageKey(templateId) {
  return 'nameplate-editor-draft:' + (templateId || currentTemplateId() || 'corrector');
}
function scheduleDraftSave() {
  if (!state.document) return;
  if (state.draftTimer) clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => {
    state.draftTimer = null;
    try {
      const payload = {
        savedAt: new Date().toISOString(),
        templateId: currentTemplateId(),
        document: state.document,
        sample: {
          serial: els.sampleSerial ? els.sampleSerial.value : '',
          title: els.sampleTitle ? els.sampleTitle.value : '',
          config: els.sampleConfig ? els.sampleConfig.value : '',
          release: els.sampleRelease ? els.sampleRelease.value : '',
        },
      };
      localStorage.setItem(draftStorageKey(), JSON.stringify(payload));
    } catch (_e) {}
  }, 800);
}
function clearDraft(templateId) {
  try { localStorage.removeItem(draftStorageKey(templateId)); } catch (_e) {}
}
function restoreDraftIfAny(templateId) {
  try {
    const raw = localStorage.getItem(draftStorageKey(templateId));
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || !draft.document) return false;
    if (!window.confirm(T.draftRestored + '.\n\nПрименить несохранённый черновик от ' + (draft.savedAt || '?') + '?')) {
      return false;
    }
    state.document = draft.document;
    clearSelection();
    if (draft.sample) {
      if (els.sampleSerial) els.sampleSerial.value = draft.sample.serial || sampleSerialDefault();
      if (els.sampleTitle) els.sampleTitle.value = draft.sample.title || '';
      if (els.sampleConfig) els.sampleConfig.value = draft.sample.config || '';
      if (els.sampleRelease) els.sampleRelease.value = draft.sample.release || '';
    }
    pushHistory();
    ensureLayoutSettings();
    syncMarginCheckbox();
    applyZoom();
    schedulePreview();
    updateDirtyUi();
    setStatus(T.draftRestored, 'info');
    return true;
  } catch (_e) {
    return false;
  }
}
function exportTemplateJson() {
  if (!state.document) return;
  syncDynamicFields();
  const blob = new Blob([JSON.stringify(state.document, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentTemplateId() || 'nameplate') + '-template.fields.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  setStatus(T.exportJsonOk, 'success');
}
async function downloadPreviewPdf() {
  if (!state.previewUrl) {
    await previewPdf(false);
  }
  if (!state.previewUrl) {
    setStatus(T.downloadPdfNeed, 'warning');
    return;
  }
  const a = document.createElement('a');
  a.href = state.previewUrl;
  a.download = (buildPayload().serial || currentTemplateId() || 'nameplate') + '-preview.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus(T.downloadPdfOk, 'success');
}
function onCanvasWheel(ev) {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  const delta = ev.deltaY > 0 ? -0.1 : 0.1;
  state.zoom = Math.min(3, Math.max(0.25, Math.round((state.zoom + delta) * 10) / 10));
  applyZoom();
}
function onObjectDblClick(ev) {
  const objEl = ev.target.closest('.bt-obj');
  if (!objEl) return;
  const id = objEl.dataset.id;
  const obj = getObject(id);
  if (!obj || obj.type === 'static') return;
  selectObject(id);
  if (obj.type === 'text' || obj.type === 'qr') {
    state.propsTab = obj.type === 'qr' ? 'position' : 'font';
    renderProps();
    const focus = els.props.querySelector(obj.type === 'text' ? '[data-prop="fontMm"],[data-prop="fontPt"],[data-prop="fixedText"]' : '[data-prop="barcodeType"],[data-prop="qrSizeMm"]');
    if (focus) { try { focus.focus(); focus.select && focus.select(); } catch (_e) {} }
  }
}


function hideCtxMenu() {
  if (!els.ctxMenu) return;
  els.ctxMenu.classList.add('d-none');
  els.ctxMenu.hidden = true;
}
function showCtxMenu(clientX, clientY, objId) {
  if (!els.ctxMenu) return;
  if (objId) {
    if (!isSelected(objId)) selectObject(objId);
    else state.selectedId = objId;
  }
  const hasSel = selectedList().length > 0;
  els.ctxMenu.querySelectorAll('[data-ctx]').forEach(btn => {
    const act = btn.getAttribute('data-ctx');
    const needSel = ['props','dup','copy','lock','hide','fwd','back','front','rear','del','copyStyle','pasteStyle','center','rename'].includes(act);
    btn.disabled = needSel && !hasSel;
    if (act === 'pasteStyle') btn.disabled = !state.styleClipboard;
    btn.classList.toggle('text-muted', btn.disabled);
  });
  els.ctxMenu.classList.remove('d-none');
  els.ctxMenu.hidden = false;
  const pad = 8;
  const w = els.ctxMenu.offsetWidth || 200;
  const h = els.ctxMenu.offsetHeight || 280;
  let x = clientX, y = clientY;
  if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
  if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
  els.ctxMenu.style.left = Math.max(pad, x) + 'px';
  els.ctxMenu.style.top = Math.max(pad, y) + 'px';
}
function onCtxMenuAction(act) {
  hideCtxMenu();
  if (act === 'props') {
    const obj = getObject(state.selectedId);
    if (obj && (obj.type === 'text' || obj.type === 'qr')) {
      state.propsTab = obj.type === 'qr' ? 'position' : 'font';
      renderProps();
    }
  } else if (act === 'dup') duplicateSelected();
  else if (act === 'copy') copySelected();
  else if (act === 'paste') pasteClipboard();
  else if (act === 'lock') toggleLock();
  else if (act === 'hide') toggleVisible();
  else if (act === 'fwd') zOrder(10);
  else if (act === 'back') zOrder(-10);
  else if (act === 'front') bringToFront();
  else if (act === 'rear') sendToBack();
  else if (act === 'copyStyle') copyStyle();
  else if (act === 'pasteStyle') pasteStyle();
  else if (act === 'center') centerSelectionOnLabel();
  else if (act === 'rename') renameSelected();
  else if (act === 'del') deleteSelected();
  else if (act === 'addText') addTextObject();
  else if (act === 'addQr') addQrObject();
}
function onStageContextMenu(ev) {
  ev.preventDefault();
  const objEl = ev.target.closest('.bt-obj');
  showCtxMenu(ev.clientX, ev.clientY, objEl ? objEl.dataset.id : null);
}

function importTemplateJsonFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(String(reader.result || ''));
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.editorObjects)) {
        throw new Error(T.importJsonErr);
      }
      if (!window.confirm(T.importJsonConfirm)) return;
      state.document = doc;
      if (!state.document.templateId) state.document.templateId = currentTemplateId();
      clearSelection();
      pushHistory();
      ensureLayoutSettings();
      syncMarginCheckbox();
      applyZoom();
      schedulePreview();
      updateDirtyUi();
      setStatus(T.importJsonOk, 'success');
    } catch (err) {
      setStatus((err && err.message) || T.importJsonErr, 'danger');
    }
  };
  reader.onerror = () => setStatus(T.importJsonErr, 'danger');
  reader.readAsText(file, 'utf-8');
}
function openImportJsonPicker() {
  if (!els.importJsonFile) return;
  els.importJsonFile.value = '';
  els.importJsonFile.click();
}
function onCanvasPointerDown(ev) {
  if (state.spaceDown || ev.button === 1) {
    ev.preventDefault();
    state.pan = {
      startX: ev.clientX,
      startY: ev.clientY,
      scrollLeft: els.canvasScroll.scrollLeft,
      scrollTop: els.canvasScroll.scrollTop,
    };
    els.canvasScroll.classList.add('is-panning');
    window.addEventListener('pointermove', onCanvasPanMove);
    window.addEventListener('pointerup', onCanvasPanUp);
    return;
  }
}
function onCanvasPanMove(ev) {
  if (!state.pan) return;
  const dx = ev.clientX - state.pan.startX;
  const dy = ev.clientY - state.pan.startY;
  els.canvasScroll.scrollLeft = state.pan.scrollLeft - dx;
  els.canvasScroll.scrollTop = state.pan.scrollTop - dy;
}
function onCanvasPanUp() {
  state.pan = null;
  if (els.canvasScroll) els.canvasScroll.classList.remove('is-panning');
  window.removeEventListener('pointermove', onCanvasPanMove);
  window.removeEventListener('pointerup', onCanvasPanUp);
}

function bindUi() {
  applyPanelLayout();
  if (els.collapseLeft) els.collapseLeft.onclick = () => setPanelCollapsed('left', true);
  if (els.collapseRight) els.collapseRight.onclick = () => setPanelCollapsed('right', true);
  if (els.restoreLeft) els.restoreLeft.onclick = () => setPanelCollapsed('left', false);
  if (els.restoreRight) els.restoreRight.onclick = () => setPanelCollapsed('right', false);
  $('btNewTemplate').onclick=openNewTemplateModal; $('btNewCreate').onclick=createNewTemplate; $('btSave').onclick=saveTemplate; $('btImport').onclick=importBtw; $('btReset').onclick=resetDoc; $('btResetZero').onclick=resetToDefaults; $('btApplyReference').onclick=applyReferenceLayout; $('btClearAll').onclick=clearAllObjects;
  const exp=$('btExportJson'); if (exp) exp.onclick=exportTemplateJson;
  const impJ=$('btImportJson'); if (impJ) impJ.onclick=openImportJsonPicker;
  if (els.importJsonFile) els.importJsonFile.onchange=()=>{ const f=els.importJsonFile.files&&els.importJsonFile.files[0]; if (f) importTemplateJsonFile(f); };
  const dl=$('btDownloadPdf'); if (dl) dl.onclick=()=>{ void downloadPreviewPdf(); };
  const dlBtn=$('btDownloadPdfBtn'); if (dlBtn) dlBtn.onclick=()=>{ void downloadPreviewPdf(); };
  $('btLabelSetup').onclick=showLabelSetup; $('btPreview').onclick=previewPdf; $('btPrint').onclick=printLabel;
  $('btUndo').onclick=undo; $('btRedo').onclick=redo;
  $('btAddText').onclick=addTextObject; $('btAddQr').onclick=addQrObject;
  const addLine=$('btAddLine'); if (addLine) addLine.onclick=addLineObject;
  const addBox=$('btAddBox'); if (addBox) addBox.onclick=addBoxObject;
  const addImg=$('btAddImage'); if (addImg) addImg.onclick=openAddImagePicker;
  if (els.addImageFile) els.addImageFile.onchange=onAddImageFile;
  if (els.calibSave) els.calibSave.onclick=()=>{ void savePrintCalib(); };
  if (els.calibTest) els.calibTest.onclick=()=>{ void printLabel(); };
  [els.calibDensity,els.calibSpeed,els.calibYOffset,els.calibThreshold].forEach(el=>{ if (el) el.oninput=syncCalibLabels; });
  if (els.batchPrint) els.batchPrint.onclick=()=>{ void runBatchPrint(); };
  if (els.batchStop) els.batchStop.onclick=stopBatchPrint;
  if (els.batchExpand) els.batchExpand.onclick=expandBatchRangeInput;
  if (els.renameTemplateBtn) els.renameTemplateBtn.onclick=()=>{ void renameCurrentTemplate(); };
  if (els.duplicateTemplateBtn) els.duplicateTemplateBtn.onclick=()=>{ void duplicateCurrentTemplate(); };
  if (els.fillReferenceBtn) els.fillReferenceBtn.onclick=()=>{ void applyReferenceLayout(); };
  const grp=$('btGroup'); if (grp) grp.onclick=groupSelected;
  const ug=$('btUngroup'); if (ug) ug.onclick=ungroupSelected;
  if (els.thermalPreview) els.thermalPreview.onchange=()=>{ updatePreviewPresentation(); void previewPdf(true); };
  if (els.sideBySide) els.sideBySide.onchange=()=>{ updatePreviewPresentation(); };
  if (els.downloadPngBtn) els.downloadPngBtn.onclick=()=>{ void downloadPreviewPng(); };
  void loadPrintCalib();
  $('btDelete').onclick=deleteSelected; $('btDuplicate').onclick=duplicateSelected;
  $('btCopy').onclick=copySelected; $('btPaste').onclick=pasteClipboard;
  $('btLock').onclick=toggleLock; $('btHide').onclick=toggleVisible;
  $('btBringFwd').onclick=()=>zOrder(10); $('btSendBack').onclick=()=>zOrder(-10);
  const bf=$('btBringFront'); if (bf) bf.onclick=bringToFront;
  const sr=$('btSendRear'); if (sr) sr.onclick=sendToBack;
  const ms=$('btMatchSize'); if (ms) ms.onclick=matchSizeToPrimary;
  const sw=$('btSameW'); if (sw) sw.onclick=()=>matchDimension('w');
  const sh=$('btSameH'); if (sh) sh.onclick=()=>matchDimension('h');
  const cl=$('btCenterLabel'); if (cl) cl.onclick=centerSelectionOnLabel;
  const cs=$('btCopyStyle'); if (cs) cs.onclick=copyStyle;
  const ps=$('btPasteStyle'); if (ps) ps.onclick=pasteStyle;
  const cg=$('btClearGuides'); if (cg) cg.onclick=clearPinnedGuides;
  if (els.agentStatus) {
    els.agentStatus.onclick = () => { void refreshAgentStatus(); };
    void refreshAgentStatus();
    setInterval(() => { void refreshAgentStatus(); }, 15000);
  }
  $('btAlignLeft').onclick=()=>alignSelected('left'); $('btAlignCenter').onclick=()=>alignSelected('centerX');
  $('btAlignRight').onclick=()=>alignSelected('right'); $('btAlignTop').onclick=()=>alignSelected('top');
  $('btAlignMiddle').onclick=()=>alignSelected('middle'); $('btAlignBottom').onclick=()=>alignSelected('bottom');
  const dh=$('btDistH'); if (dh) dh.onclick=()=>distributeSelected('h');
  const dv=$('btDistV'); if (dv) dv.onclick=()=>distributeSelected('v');
  const help=$('btHelp'); if (help) help.onclick=openHelpModal;
  const helpBtn=$('btHelpBtn'); if (helpBtn) helpBtn.onclick=openHelpModal;
  if (els.layerSearch) {
    els.layerSearch.oninput = () => {
      state.layerFilter = els.layerSearch.value || '';
      renderObjectList();
    };
  }
  $('btZoomIn').onclick=()=>{state.zoom=Math.min(3,Math.round((state.zoom+0.1)*10)/10);applyZoom();};
  $('btZoomOut').onclick=()=>{state.zoom=Math.max(0.25,Math.round((state.zoom-0.1)*10)/10);applyZoom();};
  $('btZoomFit').onclick=zoomFit;
  document.querySelectorAll('[data-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-zoom');
      if (v === 'fit') zoomFit();
      else { state.zoom = Number(v) || 1; applyZoom(); }
    });
  });
  const rhParent = els.rulerH && els.rulerH.parentElement;
  const rvParent = els.rulerV && els.rulerV.parentElement;
  if (rhParent) rhParent.addEventListener('click', (ev) => { if (ev.target.closest('.bt-ruler-hair')) return; pinGuideFromRuler(ev, 'v'); });
  if (rvParent) rvParent.addEventListener('click', (ev) => { if (ev.target.closest('.bt-ruler-hair')) return; pinGuideFromRuler(ev, 'h'); });
  els.objects.addEventListener('pointerover', onObjectHover);
  els.objects.addEventListener('pointerout', (ev) => {
    if (!ev.relatedTarget || !els.objects.contains(ev.relatedTarget)) {
      state.hoverId = null;
      els.objects.querySelectorAll('.bt-obj.is-hover').forEach(n => n.classList.remove('is-hover'));
    }
  });
  els.showGrid.onchange=updateGrid; els.showBg.onchange=updateGrid;
  if (els.showMargins) els.showMargins.onchange = () => { layoutSettings().showMarginGuides = els.showMargins.checked; renderMarginGuides(); };
  if (els.showOverlay) els.showOverlay.onchange = () => { void onOverlayToggle(); };
  if (els.overlayOpacity) els.overlayOpacity.oninput = setOverlayOpacity;
  syncOverlayControls();

  els.labelStage.onpointerdown=onPointerDown; els.labelBg.onload=zoomFit;
  els.labelStage.addEventListener('pointermove', updateCursorFromEvent);
  els.labelStage.addEventListener('dblclick', onObjectDblClick);
  els.labelStage.addEventListener('contextmenu', onStageContextMenu);
  if (els.ctxMenu) {
    els.ctxMenu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-ctx]');
      if (btn && !btn.disabled) onCtxMenuAction(btn.getAttribute('data-ctx'));
    });
  }
  document.addEventListener('pointerdown', (ev) => {
    if (els.ctxMenu && !els.ctxMenu.hidden && !ev.target.closest('#btCtxMenu')) hideCtxMenu();
  });
  els.canvasScroll.addEventListener('wheel', onCanvasWheel, { passive: false });
  els.canvasScroll.addEventListener('pointerdown', onCanvasPointerDown);
  els.canvasScroll.addEventListener('pointerleave', () => {
    [els.crosshairV, els.crosshairH, els.rulerHairV, els.rulerHairH].forEach(el => { if (el) el.classList.add('is-hidden'); });
  });
  els.canvasScroll.onscroll=drawRulers; window.onresize=()=>{drawRulers();zoomFit();};
  window.onkeydown=onKeyDown;
  window.onkeyup=onKeyUp;
  window.addEventListener('paste', onPaste);
  window.addEventListener('beforeunload', (ev) => {
    if (!hasUnsavedChanges()) return;
    ev.preventDefault();
    ev.returnValue = '';
  });
  [els.sampleSerial,els.sampleConfig,els.sampleRelease,els.sampleTitle].forEach(el=>{
    if (!el) return;
    el.oninput=()=>{ renderObjects(); schedulePreview(); scheduleDraftSave(); };
  });
  if (els.templateSelect) els.templateSelect.onchange = () => switchTemplate(els.templateSelect.value);
  if (els.deleteTemplateBtn) els.deleteTemplateBtn.onclick = deleteCurrentTemplate;
}
bindUi(); loadTemplate();
})();
