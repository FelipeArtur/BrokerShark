# /venv

Manage the project virtualenv at `.venv/` (Python 3.14.4).

## Venv location

```
/home/felipe/Projetos/brokershark/.venv/
```

Created with:
```bash
python -m venv .venv
```

## What to do

1. **Check if `.venv/` exists** — look for `.venv/pyvenv.cfg` in the project root.

2. **If it does not exist — create it:**
```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

3. **If it exists but dependencies may be out of sync** (e.g. after `requirements.txt` changed):
```bash
.venv/bin/pip install -r requirements.txt
```

4. **To run any Python script in this project, always use:**
```bash
.venv/bin/python backend/main.py
```
or equivalently, activate first:
```bash
# fish
source .venv/bin/activate.fish
# bash/zsh
source .venv/bin/activate
```

5. **To run a one-off command inside the venv without activating:**
```bash
.venv/bin/python -c "import flask; print(flask.__version__)"
```

## Checking installed packages

```bash
.venv/bin/pip list
.venv/bin/pip show <package>
```

## Expected state (healthy venv)

```
.venv/pyvenv.cfg        exists
.venv/bin/python        executable
.venv/bin/pip           executable
python-telegram-bot     21.x
flask                   3.1.x
waitress                3.0.x
gspread                 6.x
APScheduler             3.x
```

Run this to verify:
```bash
.venv/bin/python -c "
import telegram, flask, waitress, gspread, apscheduler
print('python-telegram-bot:', telegram.__version__)
print('flask:', flask.__version__)
print('waitress:', waitress.__version__)
print('gspread:', gspread.__version__)
print('apscheduler:', apscheduler.__version__)
print('All OK')
"
```
