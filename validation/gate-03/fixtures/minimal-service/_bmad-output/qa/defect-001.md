# QA Defect Report: DEFECT-G03-001
**Title:** Millisecond Unix timestamp rejected unexpectedly  
**Severity:** P2 (High)  
**Found By:** QA / Test Architect  
**Description:** Webhook providers sending timestamps in milliseconds (> 1e11) are rejected because validator treats numbers as seconds.
