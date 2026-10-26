# Multitenant ADMS Server

Connect your **ZKTeco** or **eSSL** biometric attendance devices to the cloud
and get every punch delivered straight to your own system (ERPNext / Frappe HR,
or any webhook URL).

**Ready to use — free, nothing to install: [adms.adrk.in](https://adms.adrk.in)**

## How it works

1. Your attendance device sends each punch to this server over the internet.
2. The server stores it under your company and shows it in an admin panel.
3. Each punch is forwarded to your webhook (e.g. ERPNext Employee Checkin),
   with automatic retries if your system is temporarily down.

Works with any device that supports ZKTeco's "Cloud Server" (ADMS / push)
setting — ZKTeco X100-C, SpeedFace, EFace, eSSL models, and similar.

## How to configure

**Prefer to watch?** A [setup demo video](https://www.youtube.com/watch?v=XgwOILGEwFI)
walks through the whole process below.

1. **Sign up** at [adms.adrk.in/admin/signup](https://adms.adrk.in/admin/signup).
   Pick a company name and a short URL slug (e.g. `acme-corp`).
2. **Point your device** at the server. On the device go to
   **Menu → COMM → Cloud Server Setting**, turn **Enable Domain Name** ON,
   and enter:

   ```
   https://adms.adrk.in/<your-company-slug>/<any-secret-you-choose>
   ```

   If your device doesn't accept `https://`, try `http://`, or the address
   with no `http(s)://` prefix at all.
3. **Claim the device.** Within a minute it appears under
   **Unregistered Devices** in the admin panel. Pick its timezone and click
   **Claim**, then restart the device once so its clock syncs.
4. **Add a webhook** (optional). In **Devices → Webhook**, enter the URL
   where punches should be sent — or pick the **ERPNext** template and fill
   in your site and API keys. Use **Send test webhook** to check it works.

That's it — punches now show up in **Punch Records** and flow to your webhook.

## Hosted version

[adms.adrk.in](https://adms.adrk.in) runs this exact open-source code.

- **Free** for genuine use. Spam/abuse sign-ups are blocked.
- **HTTPS supported** out of the box.
- **Each company is fully isolated** and self-service.
- **Data is kept for 10 days**, then deleted automatically — make sure your
  webhook picks up punches within that window.
- Failed webhooks are attempted up to 5 times in total (with increasing
  delays), then appear under **Failed Webhooks** for manual retry.
- Best-effort service, **no uptime guarantee**. Need more control? Self-host
  it — same software, no differences.

## Legal notice and disclaimer

- **Independent project.** This software is not affiliated with, endorsed by,
  or sponsored by ZKTeco Co., Ltd., eSSL, or any of their subsidiaries.
  *ZKTeco*, *eSSL*, and *ADMS* are trademarks or product names of their
  respective owners and are used here only to describe device compatibility.
- **Third-party protocol.** ADMS (the "push" / Cloud Server protocol) was
  developed and is controlled by ZKTeco; it is not an open standard.
  This server is an independent implementation. It contains no ZKTeco
  source code, firmware, SDK, or other proprietary material.
- **Legality is your responsibility.** Whether using or reimplementing a
  vendor-controlled protocol is lawful depends on your jurisdiction, your
  contracts with the device vendor (warranty, EULA, firmware terms), and
  applicable interoperability and reverse-engineering laws. The author makes no claim
  that it is lawful in your situation. If in doubt, take legal advice first.
- **Biometric and personal data.** Attendance and biometric data are
  regulated in many places (e.g. GDPR, India's DPDP Act, BIPA). You are
  solely responsible for employee notice and consent, lawful basis, data
  retention, and security.
- **No warranty, no liability.** Provided "as is", without warranty of any
  kind. To the maximum extent permitted by law, the author and contributors
  are not liable for any claim, damage, loss, or legal consequence arising
  from use of this software or the hosted service, including any dispute with
  ZKTeco or any other third party. You use it entirely at your own risk.
- **Takedown.** If you are a rights holder and believe something here
  infringes your rights, please open an issue and it will be reviewed promptly.

*This section is general information, not legal advice.*

## More

- [Technical reference](docs/REFERENCE.md) — architecture, self-hosting with
  Docker, webhook format, security notes, and tests.
- [Changelog](CHANGELOG.md)
