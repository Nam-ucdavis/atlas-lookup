"""Where things live.

The package itself holds only code and the web UI. Everything per user lives
in a data folder (default ~/.atlaslookup, or $ATLASLOOKUP_HOME):

  atlases/        downloaded / imported atlases (`atlaslookup setup`, `add`)
  grids/          voxel grids for voxel-index input (`add-grid`)
  templates/      the MNI template shown in the viewer
  settings.json   machine-specific settings, e.g. where your results live
"""
import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"

DATA_DIR = Path(os.environ.get("ATLASLOOKUP_HOME", "~/.atlaslookup")).expanduser()
ATLASES_DIR = DATA_DIR / "atlases"
GRIDS_DIR = DATA_DIR / "grids"
TEMPLATE_FILE = DATA_DIR / "templates" / "mni152_2009a_1mm.nii.gz"
SETTINGS_FILE = DATA_DIR / "settings.json"
