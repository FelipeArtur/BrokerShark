# /venv

Manage the project virtualenv at `.venv/` (Python 3.14.4).

## Venv location

```
<raiz do projeto>/.venv/
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
.venv/pyvenv.cfg           exists
.venv/bin/python           executable
.venv/bin/pip              executable
flask                      3.1.x
waitress                   3.0.x
python-dotenv              1.1.x
openpyxl                   3.1.x
pytest / ruff / mypy       (dev — Health Stack)
```

Run this to verify:
```bash
.venv/bin/python -c "
import flask, waitress, dotenv, openpyxl
print('flask:', flask.__version__)
print('waitress:', waitress.__version__)
print('openpyxl:', openpyxl.__version__)
print('All OK')
"
```
