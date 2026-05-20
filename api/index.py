import os
import sys

# Add the parent directory (project root) to the system path so that Vercel's runtime 
# can cleanly import 'main.py' and other local modules (like google_calendar)
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
