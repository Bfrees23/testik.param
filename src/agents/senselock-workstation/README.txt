TM-07 Senselock workstation agent
=================================

1. Insert Senselock Elite4 USB key.
2. Run TM07-Senselock-Agent.cmd (or start-senselock-agent.cmd).
3. Keep the window open. Check: http://127.0.0.1:18779/status

FULL chip fields (serial HUSN, customer ID, space, date, PIN check):
  Copy Sense4.dll from Elite4 SDK into this folder
  (same bitness as PowerShell: usually x64).
  Optional: set TM07_SENSE4_DLL / TM07_SENSE4_USER_PIN

Without Sense4.dll the agent still dumps Windows/PnP/USB info.
Data FILES inside the key need file IDs + EXF (not readable as plain files).

Stop: close window / Ctrl+C
