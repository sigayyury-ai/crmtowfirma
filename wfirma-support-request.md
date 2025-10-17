# Запрос в техподдержку wFirma

## Польский текст для отправки:

**Temat:** Problem z wyświetlaniem nazwy produktu w fakturach proforma - zawsze pokazuje "__empty"

**Treść:**

Dzień dobry,

Mam problem z API wFirma przy tworzeniu faktur proforma. Niezależnie od tego, jakie dane wysyłam w XML, nazwa produktu zawsze wyświetla się jako "__empty" w wygenerowanej fakturze.

**Szczegóły problemu:**
- Endpoint: POST /invoices/add?outputFormat=xml&inputFormat=xml&company_id=885512
- Typ faktury: proforma (używam `<type>proforma</type>`)
- Problem: nazwa produktu zawsze wyświetla się jako "__empty"

**Testowane warianty XML:**

1. **Z CDATA:**
```xml
<entry>
    <name><![CDATA[NY2026 TEST]]></name>
    <description><![CDATA[NY2026 TEST]]></description>
    <unit>szt.</unit>
    <count>1</count>
    <price>100.00</price>
    <vat_rate>0</vat_rate>
    <netto>100.00</netto>
    <brutto>100.00</brutto>
    <type>service</type>
</entry>
```

2. **Z good_id (istniejący produkt):**
```xml
<entry>
    <good_id>41781610</good_id>
    <name>NY2026 TEST</name>
    <count>1</count>
    <price>100.00</price>
    <type>service</type>
</entry>
```

3. **Minimalna wersja:**
```xml
<entry>
    <name>NY2026 TEST</name>
    <count>1</count>
    <price>100.00</price>
</entry>
```

**Wszystkie warianty** dają ten sam rezultat - nazwa produktu w fakturze proforma pokazuje się jako "__empty".

**Przykłady utworzonych faktur:**
- Proforma ID: 388541743 (najnowsza, minimalna wersja)
- Proforma ID: 388541623 (bez good_id)
- Proforma ID: 388541308 (z nowym produktem)

**Pytania:**
1. Czy jest to znany problem z API dla faktur proforma?
2. Jakie pola są wymagane dla poprawnego wyświetlania nazwy produktu?
3. Czy istnieje specjalna struktura XML dla produktów w fakturach proforma?

**Dane techniczne:**
- Company ID: 885512
- Autoryzacja: Bearer token przez API Key
- Format: XML input/output
- Produkty tworzone przez API mają poprawne nazwy w systemie

Proszę o pomoc w rozwiązaniu tego problemu.

Z poważaniem,
[Twoje imię]

---

## English version (if needed):

**Subject:** Product name display issue in proforma invoices - always shows "__empty"

**Content:**

Hello,

I'm experiencing an issue with the wFirma API when creating proforma invoices. Regardless of the data I send in XML, the product name always displays as "__empty" in the generated invoice.

**Problem details:**
- Endpoint: POST /invoices/add?outputFormat=xml&inputFormat=xml&company_id=885512
- Invoice type: proforma (using `<type>proforma</type>`)
- Issue: product name always displays as "__empty"

**Tested XML variants:**
[Same examples as above]

**Questions:**
1. Is this a known issue with the API for proforma invoices?
2. What fields are required for proper product name display?
3. Is there a special XML structure for products in proforma invoices?

Please help resolve this issue.

Best regards,
[Your name]




