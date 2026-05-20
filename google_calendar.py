import os.path
from datetime import datetime, timedelta
import uuid

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/calendar.events']
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(BASE_DIR, 'credentials.json')
TOKEN_PATH = os.path.join(BASE_DIR, 'token.json')



from google_auth_oauthlib.flow import Flow

oauth_flow = None

def get_auth_url(host_url: str):
    """Generates the Google OAuth authorization URL."""
    global oauth_flow
    oauth_flow = Flow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
    oauth_flow.redirect_uri = f"{host_url}/api/google/callback"
    auth_url, _ = oauth_flow.authorization_url(prompt='consent')
    return auth_url

def save_credentials(code: str, host_url: str):
    """Fetches tokens using the authorization code and saves token.json."""
    global oauth_flow
    if oauth_flow is None:
        raise Exception("OAuth flow not initialized. Please click 'Connect Google' again.")
        
    oauth_flow.fetch_token(code=code)
    creds = oauth_flow.credentials
    with open(TOKEN_PATH, 'w') as token:
        token.write(creds.to_json())
    return True

def get_calendar_service():
    """Returns the Calendar API service if authenticated, else None."""
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                with open(TOKEN_PATH, 'w') as token:
                    token.write(creds.to_json())
            except Exception:
                return None
        else:
            return None

    try:
        service = build('calendar', 'v3', credentials=creds)
        return service
    except Exception as e:
        print(f"[GOOGLE CALENDAR] Build service error: {e}")
        return None

def create_google_meet(client_email: str, client_name: str, date_str: str, time_str: str, slot_duration: int = 30):
    """
    Creates an event on the user's primary calendar with a Google Meet link.
    Returns the Google Meet link if successful, otherwise None.
    """
    service = get_calendar_service()
    if not service:
        return None

    try:
        dt_start = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        dt_end = dt_start + timedelta(minutes=slot_duration)
        
        # Format for Google Calendar (RFC3339)
        start_time_iso = dt_start.isoformat() + "+05:30" # Assuming IST Timezone
        end_time_iso = dt_end.isoformat() + "+05:30"
        
        request_id = str(uuid.uuid4())

        event = {
            'summary': f'Growlouder  Consultation: {client_name}',
            'description': f'Growlouder  Consultation booked via Growlouder  Onboarding System.\n\nClient Name: {client_name}\nClient Email: {client_email}',
            'start': {
                'dateTime': start_time_iso,
                'timeZone': 'Asia/Kolkata',
            },
            'end': {
                'dateTime': end_time_iso,
                'timeZone': 'Asia/Kolkata',
            },
            'attendees': [
                {'email': client_email},
            ],
            'conferenceData': {
                'createRequest': {
                    'requestId': request_id,
                    'conferenceSolutionKey': {
                        'type': 'hangoutsMeet'
                    }
                }
            },
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'email', 'minutes': 24 * 60},
                    {'method': 'popup', 'minutes': 15},
                ],
            },
        }

        # Use sendUpdates='all' to let Google send the beautiful default Calendar invite too
        event = service.events().insert(
            calendarId='primary', 
            body=event, 
            conferenceDataVersion=1,
            sendUpdates='all'
        ).execute()
        
        meet_link = event.get('conferenceData', {}).get('entryPoints', [{}])[0].get('uri')
        if not meet_link:
            # Fallback if entryPoints is missing
            meet_link = event.get('hangoutLink')
            
        print(f"[GOOGLE CALENDAR] Successfully created event. Meet Link: {meet_link}")
        return meet_link

    except Exception as e:
        print(f"[GOOGLE CALENDAR] Error creating event: {e}")
        return None
