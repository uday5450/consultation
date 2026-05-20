import google_calendar

print("Checking Google Calendar Authentication...")
print("Please look at your browser window to sign in.")
service = google_calendar.get_calendar_service()
if service:
    print("Authentication successful! token.json has been created.")
else:
    print("Authentication failed.")
