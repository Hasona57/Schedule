#!/usr/bin/env python3
"""
Nile University Smart Timetable - Robust Email Dispatch Worker
Supports authenticated SMTP (Gmail, Outlook, Office 365, Custom) and Direct MX delivery.
"""

import sys
import json
import smtplib
import socket
import subprocess
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

def get_mx_records(domain):
    """Attempt to resolve MX records for a domain using nslookup or socket"""
    mx_hosts = []
    try:
        if sys.platform == "win32":
            res = subprocess.run(
                ["nslookup", "-type=MX", domain],
                capture_output=True,
                text=True,
                timeout=5
            )
            for line in res.stdout.splitlines():
                if "mail exchanger =" in line:
                    parts = line.split("mail exchanger =")
                    if len(parts) > 1:
                        mx_host = parts[1].strip().split()[-1].rstrip(".")
                        if mx_host:
                            mx_hosts.append(mx_host)
    except Exception:
        pass
    return mx_hosts

def send_via_direct_mx(to_email, from_email, msg):
    """Attempt direct delivery to recipient domain's MX server"""
    try:
        domain = to_email.split("@")[1].strip()
        mx_hosts = get_mx_records(domain)
        if not mx_hosts:
            return False, "Could not resolve MX records for " + domain

        last_err = ""
        for mx in mx_hosts:
            try:
                server = smtplib.SMTP(mx, 25, timeout=10)
                server.ehlo("nileuniversity.edu.eg")
                server.sendmail(from_email, [to_email], msg.as_string())
                server.quit()
                return True, f"Delivered directly via {mx}"
            except Exception as e:
                last_err = str(e)
                continue
        return False, last_err or "Direct MX delivery rejected"
    except Exception as ex:
        return False, str(ex)

def send_email(payload):
    to_email = (payload.get("to") or "").strip()
    if not to_email:
        return {"ok": False, "error": "Recipient email address is missing."}

    subject = payload.get("subject", "Nile University Class Reminder")
    html_content = payload.get("html", "")
    text_content = payload.get("text", "")

    smtp_host = (payload.get("smtpHost") or "").strip()
    smtp_port = int(payload.get("smtpPort") or 587)
    smtp_user = (payload.get("smtpUser") or "").strip()
    smtp_pass = (payload.get("smtpPass") or "").strip()
    from_email = (payload.get("from") or "").strip() or smtp_user or "notifications@nu.edu.eg"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Nile University Schedule <{from_email}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="nu.edu.eg")

    if text_content:
        msg.attach(MIMEText(text_content, "plain", "utf-8"))
    if html_content:
        msg.attach(MIMEText(html_content, "html", "utf-8"))

    # Case 1: Authenticated SMTP configured (Gmail, Outlook, NU Office 365, etc.)
    if smtp_user and smtp_pass:
        host = smtp_host or "smtp.gmail.com"
        try:
            if smtp_port == 465:
                server = smtplib.SMTP_SSL(host, smtp_port, timeout=15)
            else:
                server = smtplib.SMTP(host, smtp_port, timeout=15)
                server.ehlo()
                server.starttls()
                server.ehlo()

            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, [to_email], msg.as_string())
            server.quit()
            return {
                "ok": True,
                "message": f"Email successfully sent to {to_email} via {host}"
            }
        except smtplib.SMTPAuthenticationError as auth_err:
            return {
                "ok": False,
                "error": f"Authentication failed for {smtp_user}. If using Gmail, use a 16-digit App Password instead of your regular password. Details: {auth_err.smtp_error.decode('utf-8', 'ignore') if hasattr(auth_err, 'smtp_error') else str(auth_err)}"
            }
        except Exception as e:
            return {
                "ok": False,
                "error": f"SMTP Connection error ({host}:{smtp_port}): {str(e)}"
            }

    # Case 2: No SMTP credentials provided -> Try Direct MX delivery to the recipient mailbox
    success, mx_msg = send_via_direct_mx(to_email, from_email, msg)
    if success:
        return {
            "ok": True,
            "message": f"Email sent directly to {to_email} ({mx_msg})"
        }

    # Case 3: Need sender credentials
    return {
        "ok": False,
        "error": "To deliver emails to your inbox, please provide your Sender Email & Password / App Password in Notification Settings (e.g. Gmail with App Password or Microsoft 365 student mail)."
    }

def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"ok": False, "error": "No payload provided"}))
            return
        payload = json.loads(raw_input)
        result = send_email(payload)
        print(json.dumps(result))
    except Exception as ex:
        print(json.dumps({"ok": False, "error": str(ex)}))

if __name__ == "__main__":
    main()
