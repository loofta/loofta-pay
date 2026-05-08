import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface ClaimEmailData {
  id: string;
  amount: string | number;
  description?: string | null;
  senderInfo?: string | null;
  recipientEmail: string;
  scheduledAt?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromEmail =
      this.configService.get<string>('RESEND_FROM_EMAIL') || 'noreply@loofta.xyz';
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log('EmailService initialized');
    } else {
      this.logger.warn('RESEND_API_KEY not set — emails will not be sent');
    }
  }

  isAvailable(): boolean {
    return this.resend !== null;
  }

  async sendPaymentReceivedEmail(data: ClaimEmailData): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${parseFloat(String(data.amount)).toFixed(2)} USDC`;
    const claimUrl = `https://pay.loofta.xyz/c/${data.id}`;
    const subject = `You received ${amountStr} on Loofta`;
    const html = this.buildPaymentReceivedHtml({ ...data, amountStr, claimUrl });

    try {
      await this.resend.emails.send({
        from: `Loofta <${this.fromEmail}>`,
        to: data.recipientEmail,
        subject,
        html,
        ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
      });
      this.logger.log(`Payment received email scheduled for ${data.recipientEmail} (claim ${data.id}, at ${data.scheduledAt ?? 'now'})`);
    } catch (err: any) {
      this.logger.error(`Failed to send payment received email for claim ${data.id}: ${err?.message ?? err}`);
    }
  }

  async sendClaimReadyEmail(data: ClaimEmailData): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${parseFloat(String(data.amount)).toFixed(2)} USDC`;
    const claimUrl = `https://pay.loofta.xyz/c/${data.id}`;
    const subject = `You have ${amountStr} waiting for you on Loofta`;
    const html = this.buildClaimReadyHtml({ ...data, amountStr, claimUrl });

    try {
      await this.resend.emails.send({
        from: `Loofta <${this.fromEmail}>`,
        to: data.recipientEmail,
        subject,
        html,
        ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
      });
      this.logger.log(`Claim ready email scheduled for ${data.recipientEmail} (claim ${data.id}, at ${data.scheduledAt ?? 'now'})`);
    } catch (err: any) {
      this.logger.error(`Failed to send claim ready email for claim ${data.id}: ${err?.message ?? err}`);
    }
  }

  private buildPaymentReceivedHtml(data: ClaimEmailData & { amountStr: string; claimUrl: string }): string {
    const fromLine = data.senderInfo
      ? `<p style="margin:0 0 8px;color:#6B7280;font-size:15px;">From <strong style="color:#111827;">${data.senderInfo}</strong></p>`
      : '';
    const descLine = data.description
      ? `<p style="margin:16px 0 0;padding:14px 18px;background:#F9FAFB;border-radius:8px;color:#374151;font-size:14px;font-style:italic;">"${data.description}"</p>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment received</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF4A26,#FF8C00);padding:32px 40px 28px;text-align:center;">
              <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTc5IiBoZWlnaHQ9IjUwIiB2aWV3Qm94PSIwIDAgMTc5IDUwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xNTYuMzUzIDQ5Ljc5MTlDMTUzLjE5NSA0OS43OTE5IDE1MC43MjEgNDguOTM4NiAxNDguOTI5IDQ3LjIzMTlDMTQ3LjE3OSA0NS41MjUzIDE0Ni4zMDUgNDMuMTM1OSAxNDYuMzA1IDQwLjA2MzlDMTQ2LjMwNSAzNi45OTE5IDE0Ny4zMjkgMzQuNzczMyAxNDkuMzc3IDMzLjQwNzlDMTUxLjQyNSAzMS45OTk5IDE1NC4wNDkgMzEuMjk1OSAxNTcuMjQ5IDMxLjI5NTlDMTU5LjEyNiAzMS4yOTU5IDE2MC44MzMgMzEuNDIzOSAxNjIuMzY5IDMxLjY3OTlDMTYzLjkwNSAzMS45MzU5IDE2NS4yOTEgMzIuMjk4NiAxNjYuNTI5IDMyLjc2NzlIMTY2LjcyMVYzMS44MDc5QzE2Ni43MjEgMzAuODI2NiAxNjYuMzU4IDMwLjA1ODYgMTY1LjYzMyAyOS41MDM5QzE2NC45MDcgMjguOTA2NiAxNjMuOTkgMjguNjI5MyAxNjIuODgxIDI4LjY3MTlDMTYxLjgxNCAyOC42NzE5IDE2MC44OTcgMjguNzM1OSAxNjAuMTI5IDI4Ljg2MzlDMTU5LjQwMyAyOC45OTE5IDE1OC40ODYgMjkuMjA1MyAxNTcuMzc3IDI5LjUwMzlDMTU1LjMyOSAzMC4wMTU5IDE1My41NTggMjkuOTczMyAxNTIuMDY1IDI5LjM3NTlDMTUwLjU3MSAyOC43Nzg2IDE0OS41NDcgMjcuNjA1MyAxNDguOTkzIDI1Ljg1NTlDMTQ4LjQ4MSAyNC4wMjEzIDE0OC41ODcgMjIuNDg1MyAxNDkuMzEzIDIxLjI0NzlDMTUwLjA4MSAyMC4wMTA2IDE1MS4yMzMgMTkuMDUwNiAxNTIuNzY5IDE4LjM2NzlDMTU0LjA5MSAxNy43Mjc5IDE1NS41NjMgMTcuMTk0NiAxNTcuMTg1IDE2Ljc2NzlDMTU4Ljg0OSAxNi4zNDEzIDE2MC42NDEgMTYuMTI3OSAxNjIuNTYxIDE2LjEyNzlDMTY4LjE1IDE2LjEyNzkgMTcyLjI0NiAxNy40OTMzIDE3NC44NDkgMjAuMjIzOUMxNzcuNDk0IDIyLjkxMTkgMTc4LjgxNyAyNy40MzQ2IDE3OC44MTcgMzMuNzkxOVY0My43MTE5QzE3OC44MTcgNDUuNDYxMyAxNzguMjgzIDQ2LjkxMTkgMTc3LjIxNyA0OC4wNjM5QzE3Ni4xNSA0OS4yMTU5IDE3NC42NzggNDkuNzkxOSAxNzIuODAxIDQ5Ljc5MTlDMTcwLjc1MyA0OS43OTE5IDE2OS4yMTcgNDkuMjE1OSAxNjguMTkzIDQ4LjA2MzlDMTY3LjIxMSA0Ni45MTE5IDE2Ni43MjEgNDUuNTAzOSAxNjYuNzIxIDQzLjgzOTlWNDIuMzY3OUgxNjUuNDQxQzE2NS40NDEgNDMuNDc3MyAxNjUuMjI3IDQ0LjYwNzkgMTY0LjgwMSA0NS43NTk5QzE2NC40MTcgNDYuOTExOSAxNjMuNTg1IDQ3Ljg3MTkgMTYyLjMwNSA0OC42Mzk5QzE2MS4wNjcgNDkuNDA3OSAxNTkuMDgzIDQ5Ljc5MTkgMTU2LjM1MyA0OS43OTE5Wk0xNTYuOTkzIDM1Ljc3NTlDMTU2Ljk5MyAzNi41MDEzIDE1Ny4yNDkgMzcuMDEzMyAxNTcuNzYxIDM3LjMxMTlDMTU4LjMxNSAzNy42MTA2IDE1OS40ODkgMzcuNzU5OSAxNjEuMjgxIDM3Ljc1OTlDMTYyLjkwMiAzNy43NTk5IDE2NC4wMzMgMzcuNjEwNiAxNjQuNjczIDM3LjMxMTlDMTY1LjMxMyAzNy4wMTMzIDE2NS42MzMgMzYuNTAxMyAxNjUuNjMzIDM1Ljc3NTlDMTY1LjYzMyAzNS4wOTMzIDE2NS4zMTMgMzQuNjIzOSAxNjQuNjczIDM0LjM2NzlDMTY0LjAzMyAzNC4wNjkzIDE2Mi45MDIgMzMuOTE5OSAxNjEuMjgxIDMzLjkxOTlDMTU5LjQ4OSAzMy45MTk5IDE1OC4zMTUgMzQuMDY5MyAxNTcuNzYxIDM0LjM2NzlDMTU3LjI0OSAzNC42MjM5IDE1Ni45OTMgMzUuMDkzMyAxNTYuOTkzIDM1Ljc3NTlaIiBmaWxsPSIjZmZmZmZmIi8+PHBhdGggZD0iTTEzMi4yNTMgNDkuOTg0QzEyOS45OTIgNDkuOTg0IDEyNy45NDQgNDkuNDcyIDEyNi4xMDkgNDguNDQ4QzEyNC4zMTcgNDcuNDI0IDEyMi45MDkgNDUuOTczNCAxMjEuODg1IDQ0LjA5NkMxMjAuODYxIDQyLjE3NiAxMjAuMzQ5IDM5LjkzNiAxMjAuMzQ5IDM3LjM3NlYyNi4xMTJMMTE3Ljk4MSAyNi40MzJDMTE2LjcwMSAyNi42MDI3IDExNS41NzEgMjYuMTU0NyAxMTQuNTg5IDI1LjA4OEMxMTMuNjA4IDI0LjAyMTQgMTEzLjExNyAyMi42Nzc0IDExMy4xMTcgMjEuMDU2QzExMy4xMTcgMTkuNDM0NyAxMTMuNjA4IDE4LjExMiAxMTQuNTg5IDE3LjA4OEMxMTUuNTcxIDE2LjAyMTQgMTE2LjcwMSAxNS41NzM0IDExNy45ODEgMTUuNzQ0TDEyMC4zNDkgMTYuMDY0TDEyMC4yODUgMTEuNzEyQzEyMC4yNDMgMTAuMDA1NCAxMjAuNzMzIDguNjYxMzggMTIxLjc1NyA3LjY4MDA0QzEyMi43ODEgNi42NTYwNCAxMjQuMjc1IDYuMTQ0MDQgMTI2LjIzNyA2LjE0NDA0QzEyOC4yIDYuMTQ0MDQgMTI5LjcxNSA2LjY1NjA0IDEzMC43ODEgNy42ODAwNEMxMzEuODQ4IDguNjYxMzggMTMyLjMzOSAxMC4wMDU0IDEzMi4yNTMgMTEuNzEyTDEzMi4xMjUgMTYuMDY0TDEzNS41MTcgMTUuNjE2QzEzNy44MjEgMTUuMjc0NyAxMzkuNTcxIDE1LjcwMTQgMTQwLjc2NSAxNi44OTZDMTQxLjk2IDE4LjA0OCAxNDIuNTU3IDE5LjQzNDcgMTQyLjU1NyAyMS4wNTZDMTQyLjU1NyAyMi42Nzc0IDE0MS45NiAyNC4wODU0IDE0MC43NjUgMjUuMjhDMTM5LjYxMyAyNi40MzIgMTM3LjkyOCAyNi44NTg3IDEzNS43MDkgMjYuNTZMMTMyLjEyNSAyNi4xMTJWMzUuNjQ4QzEzMi4xMjUgMzYuMjAyNyAxMzIuMzE3IDM2LjcxNDcgMTMyLjcwMSAzNy4xODRDMTMzLjA4NSAzNy42MTA3IDEzMy41NTUgMzcuNzM4NyAxMzQuMTA5IDM3LjU2OEMxMzQuNzQ5IDM3LjM5NzQgMTM1LjQxMSAzNy4wMzQ3IDEzNi4wOTMgMzYuNDhDMTM2LjgxOSAzNS45MjU0IDEzNy43MzYgMzUuNjQ4IDEzOC44NDUgMzUuNjQ4QzE0MC41MDkgMzUuNjQ4IDE0MS43ODkgMzYuMjQ1NCAxNDIuNjg1IDM3LjQ0QzE0My41ODEgMzguNjM0NyAxNDQuMDI5IDQwLjEwNjcgMTQ0LjAyOSA0MS44NTZDMTQ0LjAyOSA0My4yMjE0IDE0My41MzkgNDQuNTQ0IDE0Mi41NTcgNDUuODI0QzE0MS42MTkgNDcuMDYxNCAxNDAuMjc1IDQ4LjA2NCAxMzguNTI1IDQ4LjgzMkMxMzYuNzc2IDQ5LjYgMTM0LjY4NSA0OS45ODQgMTMyLjI1MyA0OS45ODRaIiBmaWxsPSIjZmZmZmZmIi8+PHBhdGggZD0iTTk2LjAwMTcgNDkuNzkyQzk0LjIwOTcgNDkuNzkyIDkyLjczNzcgNDkuMjM3MyA5MS41ODU3IDQ4LjEyOEM5MC40NzY0IDQ2Ljk3NiA4OS45MjE3IDQ1LjU0NjcgODkuOTIxNyA0My44NFYyOS41NjhDODguODEyNCAyOS44MjQgODcuODA5NyAyOS42NzQ3IDg2LjkxMzcgMjkuMTJDODYuMDE3NyAyOC41NjUzIDg1LjI5MjQgMjcuNzMzMyA4NC43Mzc3IDI2LjYyNEM4NC4yMjU3IDI1LjUxNDcgODMuOTY5NyAyNC4yOTg3IDgzLjk2OTcgMjIuOTc2QzgzLjk2OTcgMjEuNjUzMyA4NC4yNDcxIDIwLjQzNzMgODQuODAxNyAxOS4zMjhDODUuMzU2NCAxOC4xNzYgODYuMDgxNyAxNy4zMDEzIDg2Ljk3NzcgMTYuNzA0Qzg3LjkxNjQgMTYuMTA2NyA4OC45NDA0IDE1Ljk3ODcgOTAuMDQ5NyAxNi4zMkM5MC4yNjMxIDEzLjE2MjcgOTAuNzc1MSAxMC4zNjggOTEuNTg1NyA3LjkzNkM5Mi4zOTY0IDUuNDYxMzQgOTMuNjMzNyAzLjUyIDk1LjI5NzcgMi4xMTJDOTcuMDA0NCAwLjcwNCA5OS4yMjMxIDAgMTAxLjk1NCAwQzEwNC4zIDAgMTA2LjE3OCAwLjQ5MDY2NyAxMDcuNTg2IDEuNDcyQzEwOC45OTQgMi40MTA2NyAxMDkuOTc1IDMuNTg0IDExMC41MyA0Ljk5MkMxMTEuMTI3IDYuNCAxMTEuMzE5IDcuODI5MzMgMTExLjEwNiA5LjI4QzExMC44OTIgMTAuNjg4IDExMC4zMTYgMTEuOTI1MyAxMDkuMzc4IDEyLjk5MkMxMDguNDM5IDE0LjAxNiAxMDcuMDUyIDE0LjUyOCAxMDUuMjE4IDE0LjUyOEMxMDMuOTM4IDE0LjUyOCAxMDIuODcxIDE0LjI3MiAxMDIuMDE4IDEzLjc2QzEwMS4xNjQgMTMuMjQ4IDEwMC40MzkgMTIuNjI5MyA5OS44NDE3IDExLjkwNEM5OS4yODcxIDExLjEzNiA5OC43OTY0IDEwLjQxMDcgOTguMzY5NyA5LjcyOEM5Ny4zMDMxIDguMDIxMzQgOTYuMjE1MSA3LjQ0NTM0IDk1LjEwNTcgOEM5NC41NTExIDguMjk4NjcgOTQuMjUyNCA4Ljc4OTMzIDk0LjIwOTcgOS40NzJDOTQuMTY3MSAxMC4xMTIgOTQuMzgwNCAxMC44NTg3IDk0Ljg0OTcgMTEuNzEyTDk2LjI1NzcgMTQuMTQ0Qzk2Ljk4MzEgMTUuMzM4NyA5Ny43NTExIDE2LjEyOCA5OC41NjE3IDE2LjUxMkM5OS4zNzI0IDE2Ljg1MzMgMTAwLjM5NiAxNi45Mzg3IDEwMS42MzQgMTYuNzY4TDEwNC43MDYgMTYuMzJDMTA2LjY2OCAxNi4wMjEzIDEwOC4yNjggMTYuNTU0NyAxMDkuNTA2IDE3LjkyQzExMC43NDMgMTkuMjg1MyAxMTEuMzYyIDIwLjk3MDcgMTExLjM2MiAyMi45NzZDMTExLjM2MiAyNS4wNjY3IDExMC43MjIgMjYuNzUyIDEwOS40NDIgMjguMDMyQzEwOC4yMDQgMjkuMjY5MyAxMDYuNjY4IDI5Ljc4MTMgMTA0LjgzNCAyOS41NjhMMTAyLjE0NiAyOS4yNDhWNDMuODRDMTAyLjE0NiA0NS41NDY3IDEwMS41OTEgNDYuOTc2IDEwMC40ODIgNDguMTI4Qzk5LjM3MjQgNDkuMjM3MyA5Ny44NzkxIDQ5Ljc5MiA5Ni4wMDE3IDQ5Ljc5MloiIGZpbGw9IiNmZmZmZmYiLz48cGF0aCBkPSJNNjcuMTk2NSA0OS45MkM2Mi4yMDQ1IDQ5LjkyIDU4LjIxNTIgNDguNDQ4IDU1LjIyODUgNDUuNTA0QzUyLjI4NDUgNDIuNTE3MyA1MC44MTI1IDM4LjMxNDYgNTAuODEyNSAzMi44OTZDNTAuODEyNSAyOS41NjggNTEuNDk1MiAyNi42NDUzIDUyLjg2MDUgMjQuMTI4QzU0LjIyNTggMjEuNjEwNiA1Ni4xMjQ1IDE5LjY0OCA1OC41NTY1IDE4LjI0QzYxLjAzMTIgMTYuNzg5MyA2My45MTEyIDE2LjA2NCA2Ny4xOTY1IDE2LjA2NEM3MC44NjU4IDE2LjA2NCA3My45MTY1IDE2Ljc4OTMgNzYuMzQ4NSAxOC4yNEM3OC43ODA1IDE5LjY0OCA4MC41OTM4IDIxLjYxMDYgODEuNzg4NSAyNC4xMjhDODMuMDI1OCAyNi42NDUzIDgzLjY0NDUgMjkuNTY4IDgzLjY0NDUgMzIuODk2QzgzLjY0NDUgMzguMzE0NiA4Mi4yNzkyIDQyLjUxNzMgNzkuNTQ4NSA0NS41MDRDNzYuODYwNSA0OC40NDggNzIuNzQzMiA0OS45MiA2Ny4xOTY1IDQ5LjkyWk01OC40Mjg1IDMxLjgwOEM1OC40Mjg1IDMzLjEzMDYgNTkuMDg5OCAzNC4wNjkzIDYwLjQxMjUgMzQuNjI0QzYxLjczNTIgMzUuMTM2IDYzLjk5NjUgMzUuMzkyIDY3LjE5NjUgMzUuMzkyQzcwLjM5NjUgMzUuMzkyIDcyLjY1NzggMzUuMTM2IDczLjk4MDUgMzQuNjI0Qzc1LjMwMzIgMzQuMDY5MyA3NS45NjQ1IDMzLjEzMDYgNzUuOTY0NSAzMS44MDhDNzUuOTY0NSAzMC41MjggNzUuMzAzMiAyOS42MzIgNzMuOTgwNSAyOS4xMkM3Mi42NTc4IDI4LjYwOCA3MC4zOTY1IDI4LjM1MiA2Ny4xOTY1IDI4LjM1MkM2My45OTY1IDI4LjM1MiA2MS43MzUyIDI4LjYwOCA2MC40MTI1IDI5LjEyQzU5LjA4OTggMjkuNjMyIDU4LjQyODUgMzAuNTI4IDU4LjQyODUgMzEuODA4WiIgZmlsbD0iI2ZmZmZmZiIvPjxwYXRoIGQ9Ik0zMS41MDkgNDkuOTJDMjYuNTE3IDQ5LjkyIDIyLjUyNzcgNDguNDQ4IDE5LjU0MSA0NS41MDRDMTYuNTk3IDQyLjUxNzMgMTUuMTI1IDM4LjMxNDYgMTUuMTI1IDMyLjg5NkMxNS4xMjUgMjkuNTY4IDE1LjgwNzcgMjYuNjQ1MyAxNy4xNzMgMjQuMTI4QzE4LjUzODMgMjEuNjEwNiAyMC40MzcgMTkuNjQ4IDIyLjg2OSAxOC4yNEMyNS4zNDM3IDE2Ljc4OTMgMjguMjIzNyAxNi4wNjQgMzEuNTA5IDE2LjA2NEMzNS4xNzgzIDE2LjA2NCAzOC4yMjkgMTYuNzg5MyA0MC42NjEgMTguMjRDNDMuMDkzIDE5LjY0OCA0NC45MDYzIDIxLjYxMDYgNDYuMTAxIDI0LjEyOEM0Ny4zMzgzIDI2LjY0NTMgNDcuOTU3IDI5LjU2OCA0Ny45NTcgMzIuODk2QzQ3Ljk1NyAzOC4zMTQ2IDQ2LjU5MTcgNDIuNTE3MyA0My44NjEgNDUuNTA0QzQxLjE3MyA0OC40NDggMzcuMDU1NyA0OS45MiAzMS41MDkgNDkuOTJaTTIyLjc0MSAzMS44MDhDMjIuNzQxIDMzLjEzMDYgMjMuNDAyMyAzNC4wNjkzIDI0LjcyNSAzNC42MjRDMjYuMDQ3NyAzNS4xMzYgMjguMzA5IDM1LjM5MiAzMS41MDkgMzUuMzkyQzM0LjcwOSAzNS4zOTIgMzYuOTcwMyAzNS4xMzYgMzguMjkzIDM0LjYyNEMzOS42MTU3IDM0LjA2OTMgNDAuMjc3IDMzLjEzMDYgNDAuMjc3IDMxLjgwOEM0MC4yNzcgMzAuNTI4IDM5LjYxNTcgMjkuNjMyIDM4LjI5MyAyOS4xMkMzNi45NzAzIDI4LjYwOCAzNC43MDkgMjguMzUyIDMxLjUwOSAyOC4zNTJDMjguMzA5IDI4LjM1MiAyNi4wNDc3IDI4LjYwOCAyNC43MjUgMjkuMTJDMjMuNDAyMyAyOS42MzIgMjIuNzQxIDMwLjUyOCAyMi43NDEgMzEuODA4WiIgZmlsbD0iI2ZmZmZmZiIvPjxwYXRoIGQ9Ik02LjI3MiA0OS43OTJDNC4xODEzMyA0OS43OTIgMi42MDI2NyA0OS4yMzczIDEuNTM2IDQ4LjEyOEMwLjUxMiA0Ny4wMTg3IDAgNDUuNjMyIDAgNDMuOTY4VjYuODQ4QzAgNS4wMTMzMyAwLjUxMiAzLjQ5ODY2IDEuNTM2IDIuMzA0QzIuNjAyNjcgMS4wNjY2NiA0LjE4MTMzIDAuNDQ3OTk4IDYuMjcyIDAuNDQ3OTk4QzguMTQ5MzMgMC40NDc5OTggOS42IDEuMDY2NjYgMTAuNjI0IDIuMzA0QzExLjY0OCAzLjQ5ODY2IDEyLjE2IDQuOTcwNjYgMTIuMTYgNi43MlY0My45NjhDMTIuMTYgNDUuNjMyIDExLjY0OCA0Ny4wMTg3IDEwLjYyNCA0OC4xMjhDOS42IDQ5LjIzNzMgOC4xNDkzMyA0OS43OTIgNi4yNzIgNDkuNzkyWiIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPgo=" alt="Loofta" width="134" height="38" style="display:block;border:0;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 24px;font-size:17px;color:#374151;font-weight:500;">Your payment has arrived 🎉</p>
              <div style="background:#FFF7F5;border:2px solid #FF4A26;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 4px;font-size:13px;color:#FF4A26;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Amount received</p>
                <p style="margin:0;font-size:40px;font-weight:800;color:#FF4A26;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              ${fromLine}
              ${descLine}
              <div style="margin-top:32px;text-align:center;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  View payment
                </a>
              </div>
              <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;text-align:center;">
                Or copy this link:<br>
                <a href="${data.claimUrl}" style="color:#FF4A26;word-break:break-all;">${data.claimUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #F3F4F6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
                You're receiving this because someone sent you a payment via Loofta.<br>
                <a href="https://pay.loofta.xyz" style="color:#FF4A26;text-decoration:none;">pay.loofta.xyz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildClaimReadyHtml(data: ClaimEmailData & { amountStr: string; claimUrl: string }): string {
    const fromLine = data.senderInfo
      ? `<p style="margin:0 0 8px;color:#6B7280;font-size:15px;">From <strong style="color:#111827;">${data.senderInfo}</strong></p>`
      : '<p style="margin:0 0 8px;color:#6B7280;font-size:15px;">Someone sent you a payment on Loofta</p>';
    const descLine = data.description
      ? `<p style="margin:16px 0 0;padding:14px 18px;background:#F9FAFB;border-radius:8px;color:#374151;font-size:14px;font-style:italic;">"${data.description}"</p>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment waiting</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF4A26,#FF8C00);padding:32px 40px 28px;text-align:center;">
              <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTc5IiBoZWlnaHQ9IjUwIiB2aWV3Qm94PSIwIDAgMTc5IDUwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xNTYuMzUzIDQ5Ljc5MTlDMTUzLjE5NSA0OS43OTE5IDE1MC43MjEgNDguOTM4NiAxNDguOTI5IDQ3LjIzMTlDMTQ3LjE3OSA0NS41MjUzIDE0Ni4zMDUgNDMuMTM1OSAxNDYuMzA1IDQwLjA2MzlDMTQ2LjMwNSAzNi45OTE5IDE0Ny4zMjkgMzQuNzczMyAxNDkuMzc3IDMzLjQwNzlDMTUxLjQyNSAzMS45OTk5IDE1NC4wNDkgMzEuMjk1OSAxNTcuMjQ5IDMxLjI5NTlDMTU5LjEyNiAzMS4yOTU5IDE2MC44MzMgMzEuNDIzOSAxNjIuMzY5IDMxLjY3OTlDMTYzLjkwNSAzMS45MzU5IDE2NS4yOTEgMzIuMjk4NiAxNjYuNTI5IDMyLjc2NzlIMTY2LjcyMVYzMS44MDc5QzE2Ni43MjEgMzAuODI2NiAxNjYuMzU4IDMwLjA1ODYgMTY1LjYzMyAyOS41MDM5QzE2NC45MDcgMjguOTA2NiAxNjMuOTkgMjguNjI5MyAxNjIuODgxIDI4LjY3MTlDMTYxLjgxNCAyOC42NzE5IDE2MC44OTcgMjguNzM1OSAxNjAuMTI5IDI4Ljg2MzlDMTU5LjQwMyAyOC45OTE5IDE1OC40ODYgMjkuMjA1MyAxNTcuMzc3IDI5LjUwMzlDMTU1LjMyOSAzMC4wMTU5IDE1My41NTggMjkuOTczMyAxNTIuMDY1IDI5LjM3NTlDMTUwLjU3MSAyOC43Nzg2IDE0OS41NDcgMjcuNjA1MyAxNDguOTkzIDI1Ljg1NTlDMTQ4LjQ4MSAyNC4wMjEzIDE0OC41ODcgMjIuNDg1MyAxNDkuMzEzIDIxLjI0NzlDMTUwLjA4MSAyMC4wMTA2IDE1MS4yMzMgMTkuMDUwNiAxNTIuNzY5IDE4LjM2NzlDMTU0LjA5MSAxNy43Mjc5IDE1NS41NjMgMTcuMTk0NiAxNTcuMTg1IDE2Ljc2NzlDMTU4Ljg0OSAxNi4zNDEzIDE2MC42NDEgMTYuMTI3OSAxNjIuNTYxIDE2LjEyNzlDMTY4LjE1IDE2LjEyNzkgMTcyLjI0NiAxNy40OTMzIDE3NC44NDkgMjAuMjIzOUMxNzcuNDk0IDIyLjkxMTkgMTc4LjgxNyAyNy40MzQ2IDE3OC44MTcgMzMuNzkxOVY0My43MTE5QzE3OC44MTcgNDUuNDYxMyAxNzguMjgzIDQ2LjkxMTkgMTc3LjIxNyA0OC4wNjM5QzE3Ni4xNSA0OS4yMTU5IDE3NC42NzggNDkuNzkxOSAxNzIuODAxIDQ5Ljc5MTlDMTcwLjc1MyA0OS43OTE5IDE2OS4yMTcgNDkuMjE1OSAxNjguMTkzIDQ4LjA2MzlDMTY3LjIxMSA0Ni45MTE5IDE2Ni43MjEgNDUuNTAzOSAxNjYuNzIxIDQzLjgzOTlWNDIuMzY3OUgxNjUuNDQxQzE2NS40NDEgNDMuNDc3MyAxNjUuMjI3IDQ0LjYwNzkgMTY0LjgwMSA0NS43NTk5QzE2NC40MTcgNDYuOTExOSAxNjMuNTg1IDQ3Ljg3MTkgMTYyLjMwNSA0OC42Mzk5QzE2MS4wNjcgNDkuNDA3OSAxNTkuMDgzIDQ5Ljc5MTkgMTU2LjM1MyA0OS43OTE5Wk0xNTYuOTkzIDM1Ljc3NTlDMTU2Ljk5MyAzNi41MDEzIDE1Ny4yNDkgMzcuMDEzMyAxNTcuNzYxIDM3LjMxMTlDMTU4LjMxNSAzNy42MTA2IDE1OS40ODkgMzcuNzU5OSAxNjEuMjgxIDM3Ljc1OTlDMTYyLjkwMiAzNy43NTk5IDE2NC4wMzMgMzcuNjEwNiAxNjQuNjczIDM3LjMxMTlDMTY1LjMxMyAzNy4wMTMzIDE2NS42MzMgMzYuNTAxMyAxNjUuNjMzIDM1Ljc3NTlDMTY1LjYzMyAzNS4wOTMzIDE2NS4zMTMgMzQuNjIzOSAxNjQuNjczIDM0LjM2NzlDMTY0LjAzMyAzNC4wNjkzIDE2Mi45MDIgMzMuOTE5OSAxNjEuMjgxIDMzLjkxOTlDMTU5LjQ4OSAzMy45MTk5IDE1OC4zMTUgMzQuMDY5MyAxNTcuNzYxIDM0LjM2NzlDMTU3LjI0OSAzNC42MjM5IDE1Ni45OTMgMzUuMDkzMyAxNTYuOTkzIDM1Ljc3NTlaIiBmaWxsPSIjZmZmZmZmIi8+PHBhdGggZD0iTTEzMi4yNTMgNDkuOTg0QzEyOS45OTIgNDkuOTg0IDEyNy45NDQgNDkuNDcyIDEyNi4xMDkgNDguNDQ4QzEyNC4zMTcgNDcuNDI0IDEyMi45MDkgNDUuOTczNCAxMjEuODg1IDQ0LjA5NkMxMjAuODYxIDQyLjE3NiAxMjAuMzQ5IDM5LjkzNiAxMjAuMzQ5IDM3LjM3NlYyNi4xMTJMMTE3Ljk4MSAyNi40MzJDMTE2LjcwMSAyNi42MDI3IDExNS41NzEgMjYuMTU0NyAxMTQuNTg5IDI1LjA4OEMxMTMuNjA4IDI0LjAyMTQgMTEzLjExNyAyMi42Nzc0IDExMy4xMTcgMjEuMDU2QzExMy4xMTcgMTkuNDM0NyAxMTMuNjA4IDE4LjExMiAxMTQuNTg5IDE3LjA4OEMxMTUuNTcxIDE2LjAyMTQgMTE2LjcwMSAxNS41NzM0IDExNy45ODEgMTUuNzQ0TDEyMC4zNDkgMTYuMDY0TDEyMC4yODUgMTEuNzEyQzEyMC4yNDMgMTAuMDA1NCAxMjAuNzMzIDguNjYxMzggMTIxLjc1NyA3LjY4MDA0QzEyMi43ODEgNi42NTYwNCAxMjQuMjc1IDYuMTQ0MDQgMTI2LjIzNyA2LjE0NDA0QzEyOC4yIDYuMTQ0MDQgMTI5LjcxNSA2LjY1NjA0IDEzMC43ODEgNy42ODAwNEMxMzEuODQ4IDguNjYxMzggMTMyLjMzOSAxMC4wMDU0IDEzMi4yNTMgMTEuNzEyTDEzMi4xMjUgMTYuMDY0TDEzNS41MTcgMTUuNjE2QzEzNy44MjEgMTUuMjc0NyAxMzkuNTcxIDE1LjcwMTQgMTQwLjc2NSAxNi44OTZDMTQxLjk2IDE4LjA0OCAxNDIuNTU3IDE5LjQzNDcgMTQyLjU1NyAyMS4wNTZDMTQyLjU1NyAyMi42Nzc0IDE0MS45NiAyNC4wODU0IDE0MC43NjUgMjUuMjhDMTM5LjYxMyAyNi40MzIgMTM3LjkyOCAyNi44NTg3IDEzNS43MDkgMjYuNTZMMTMyLjEyNSAyNi4xMTJWMzUuNjQ4QzEzMi4xMjUgMzYuMjAyNyAxMzIuMzE3IDM2LjcxNDcgMTMyLjcwMSAzNy4xODRDMTMzLjA4NSAzNy42MTA3IDEzMy41NTUgMzcuNzM4NyAxMzQuMTA5IDM3LjU2OEMxMzQuNzQ5IDM3LjM5NzQgMTM1LjQxMSAzNy4wMzQ3IDEzNi4wOTMgMzYuNDhDMTM2LjgxOSAzNS45MjU0IDEzNy43MzYgMzUuNjQ4IDEzOC44NDUgMzUuNjQ4QzE0MC41MDkgMzUuNjQ4IDE0MS43ODkgMzYuMjQ1NCAxNDIuNjg1IDM3LjQ0QzE0My41ODEgMzguNjM0NyAxNDQuMDI5IDQwLjEwNjcgMTQ0LjAyOSA0MS44NTZDMTQ0LjAyOSA0My4yMjE0IDE0My41MzkgNDQuNTQ0IDE0Mi41NTcgNDUuODI0QzE0MS42MTkgNDcuMDYxNCAxNDAuMjc1IDQ4LjA2NCAxMzguNTI1IDQ4LjgzMkMxMzYuNzc2IDQ5LjYgMTM0LjY4NSA0OS45ODQgMTMyLjI1MyA0OS45ODRaIiBmaWxsPSIjZmZmZmZmIi8+PHBhdGggZD0iTTk2LjAwMTcgNDkuNzkyQzk0LjIwOTcgNDkuNzkyIDkyLjczNzcgNDkuMjM3MyA5MS41ODU3IDQ4LjEyOEM5MC40NzY0IDQ2Ljk3NiA4OS45MjE3IDQ1LjU0NjcgODkuOTIxNyA0My44NFYyOS41NjhDODguODEyNCAyOS44MjQgODcuODA5NyAyOS42NzQ3IDg2LjkxMzcgMjkuMTJDODYuMDE3NyAyOC41NjUzIDg1LjI5MjQgMjcuNzMzMyA4NC43Mzc3IDI2LjYyNEM4NC4yMjU3IDI1LjUxNDcgODMuOTY5NyAyNC4yOTg3IDgzLjk2OTcgMjIuOTc2QzgzLjk2OTcgMjEuNjUzMyA4NC4yNDcxIDIwLjQzNzMgODQuODAxNyAxOS4zMjhDODUuMzU2NCAxOC4xNzYgODYuMDgxNyAxNy4zMDEzIDg2Ljk3NzcgMTYuNzA0Qzg3LjkxNjQgMTYuMTA2NyA4OC45NDA0IDE1Ljk3ODcgOTAuMDQ5NyAxNi4zMkM5MC4yNjMxIDEzLjE2MjcgOTAuNzc1MSAxMC4zNjggOTEuNTg1NyA3LjkzNkM5Mi4zOTY0IDUuNDYxMzQgOTMuNjMzNyAzLjUyIDk1LjI5NzcgMi4xMTJDOTcuMDA0NCAwLjcwNCA5OS4yMjMxIDAgMTAxLjk1NCAwQzEwNC4zIDAgMTA2LjE3OCAwLjQ5MDY2NyAxMDcuNTg2IDEuNDcyQzEwOC45OTQgMi40MTA2NyAxMDkuOTc1IDMuNTg0IDExMC41MyA0Ljk5MkMxMTEuMTI3IDYuNCAxMTEuMzE5IDcuODI5MzMgMTExLjEwNiA5LjI4QzExMC44OTIgMTAuNjg4IDExMC4zMTYgMTEuOTI1MyAxMDkuMzc4IDEyLjk5MkMxMDguNDM5IDE0LjAxNiAxMDcuMDUyIDE0LjUyOCAxMDUuMjE4IDE0LjUyOEMxMDMuOTM4IDE0LjUyOCAxMDIuODcxIDE0LjI3MiAxMDIuMDE4IDEzLjc2QzEwMS4xNjQgMTMuMjQ4IDEwMC40MzkgMTIuNjI5MyA5OS44NDE3IDExLjkwNEM5OS4yODcxIDExLjEzNiA5OC43OTY0IDEwLjQxMDcgOTguMzY5NyA5LjcyOEM5Ny4zMDMxIDguMDIxMzQgOTYuMjE1MSA3LjQ0NTM0IDk1LjEwNTcgOEM5NC41NTExIDguMjk4NjcgOTQuMjUyNCA4Ljc4OTMzIDk0LjIwOTcgOS40NzJDOTQuMTY3MSAxMC4xMTIgOTQuMzgwNCAxMC44NTg3IDk0Ljg0OTcgMTEuNzEyTDk2LjI1NzcgMTQuMTQ0Qzk2Ljk4MzEgMTUuMzM4NyA5Ny43NTExIDE2LjEyOCA5OC41NjE3IDE2LjUxMkM5OS4zNzI0IDE2Ljg1MzMgMTAwLjM5NiAxNi45Mzg3IDEwMS42MzQgMTYuNzY4TDEwNC43MDYgMTYuMzJDMTA2LjY2OCAxNi4wMjEzIDEwOC4yNjggMTYuNTU0NyAxMDkuNTA2IDE3LjkyQzExMC43NDMgMTkuMjg1MyAxMTEuMzYyIDIwLjk3MDcgMTExLjM2MiAyMi45NzZDMTExLjM2MiAyNS4wNjY3IDExMC43MjIgMjYuNzUyIDEwOS40NDIgMjguMDMyQzEwOC4yMDQgMjkuMjY5MyAxMDYuNjY4IDI5Ljc4MTMgMTA0LjgzNCAyOS41NjhMMTAyLjE0NiAyOS4yNDhWNDMuODRDMTAyLjE0NiA0NS41NDY3IDEwMS41OTEgNDYuOTc2IDEwMC40ODIgNDguMTI4Qzk5LjM3MjQgNDkuMjM3MyA5Ny44NzkxIDQ5Ljc5MiA5Ni4wMDE3IDQ5Ljc5MloiIGZpbGw9IiNmZmZmZmYiLz48cGF0aCBkPSJNNjcuMTk2NSA0OS45MkM2Mi4yMDQ1IDQ5LjkyIDU4LjIxNTIgNDguNDQ4IDU1LjIyODUgNDUuNTA0QzUyLjI4NDUgNDIuNTE3MyA1MC44MTI1IDM4LjMxNDYgNTAuODEyNSAzMi44OTZDNTAuODEyNSAyOS41NjggNTEuNDk1MiAyNi42NDUzIDUyLjg2MDUgMjQuMTI4QzU0LjIyNTggMjEuNjEwNiA1Ni4xMjQ1IDE5LjY0OCA1OC41NTY1IDE4LjI0QzYxLjAzMTIgMTYuNzg5MyA2My45MTEyIDE2LjA2NCA2Ny4xOTY1IDE2LjA2NEM3MC44NjU4IDE2LjA2NCA3My45MTY1IDE2Ljc4OTMgNzYuMzQ4NSAxOC4yNEM3OC43ODA1IDE5LjY0OCA4MC41OTM4IDIxLjYxMDYgODEuNzg4NSAyNC4xMjhDODMuMDI1OCAyNi42NDUzIDgzLjY0NDUgMjkuNTY4IDgzLjY0NDUgMzIuODk2QzgzLjY0NDUgMzguMzE0NiA4Mi4yNzkyIDQyLjUxNzMgNzkuNTQ4NSA0NS41MDRDNzYuODYwNSA0OC40NDggNzIuNzQzMiA0OS45MiA2Ny4xOTY1IDQ5LjkyWk01OC40Mjg1IDMxLjgwOEM1OC40Mjg1IDMzLjEzMDYgNTkuMDg5OCAzNC4wNjkzIDYwLjQxMjUgMzQuNjI0QzYxLjczNTIgMzUuMTM2IDYzLjk5NjUgMzUuMzkyIDY3LjE5NjUgMzUuMzkyQzcwLjM5NjUgMzUuMzkyIDcyLjY1NzggMzUuMTM2IDczLjk4MDUgMzQuNjI0Qzc1LjMwMzIgMzQuMDY5MyA3NS45NjQ1IDMzLjEzMDYgNzUuOTY0NSAzMS44MDhDNzUuOTY0NSAzMC41MjggNzUuMzAzMiAyOS42MzIgNzMuOTgwNSAyOS4xMkM3Mi42NTc4IDI4LjYwOCA3MC4zOTY1IDI4LjM1MiA2Ny4xOTY1IDI4LjM1MkM2My45OTY1IDI4LjM1MiA2MS43MzUyIDI4LjYwOCA2MC40MTI1IDI5LjEyQzU5LjA4OTggMjkuNjMyIDU4LjQyODUgMzAuNTI4IDU4LjQyODUgMzEuODA4WiIgZmlsbD0iI2ZmZmZmZiIvPjxwYXRoIGQ9Ik0zMS41MDkgNDkuOTJDMjYuNTE3IDQ5LjkyIDIyLjUyNzcgNDguNDQ4IDE5LjU0MSA0NS41MDRDMTYuNTk3IDQyLjUxNzMgMTUuMTI1IDM4LjMxNDYgMTUuMTI1IDMyLjg5NkMxNS4xMjUgMjkuNTY4IDE1LjgwNzcgMjYuNjQ1MyAxNy4xNzMgMjQuMTI4QzE4LjUzODMgMjEuNjEwNiAyMC40MzcgMTkuNjQ4IDIyLjg2OSAxOC4yNEMyNS4zNDM3IDE2Ljc4OTMgMjguMjIzNyAxNi4wNjQgMzEuNTA5IDE2LjA2NEMzNS4xNzgzIDE2LjA2NCAzOC4yMjkgMTYuNzg5MyA0MC42NjEgMTguMjRDNDMuMDkzIDE5LjY0OCA0NC45MDYzIDIxLjYxMDYgNDYuMTAxIDI0LjEyOEM0Ny4zMzgzIDI2LjY0NTMgNDcuOTU3IDI5LjU2OCA0Ny45NTcgMzIuODk2QzQ3Ljk1NyAzOC4zMTQ2IDQ2LjU5MTcgNDIuNTE3MyA0My44NjEgNDUuNTA0QzQxLjE3MyA0OC40NDggMzcuMDU1NyA0OS45MiAzMS41MDkgNDkuOTJaTTIyLjc0MSAzMS44MDhDMjIuNzQxIDMzLjEzMDYgMjMuNDAyMyAzNC4wNjkzIDI0LjcyNSAzNC42MjRDMjYuMDQ3NyAzNS4xMzYgMjguMzA5IDM1LjM5MiAzMS41MDkgMzUuMzkyQzM0LjcwOSAzNS4zOTIgMzYuOTcwMyAzNS4xMzYgMzguMjkzIDM0LjYyNEMzOS42MTU3IDM0LjA2OTMgNDAuMjc3IDMzLjEzMDYgNDAuMjc3IDMxLjgwOEM0MC4yNzcgMzAuNTI4IDM5LjYxNTcgMjkuNjMyIDM4LjI5MyAyOS4xMkMzNi45NzAzIDI4LjYwOCAzNC43MDkgMjguMzUyIDMxLjUwOSAyOC4zNTJDMjguMzA5IDI4LjM1MiAyNi4wNDc3IDI4LjYwOCAyNC43MjUgMjkuMTJDMjMuNDAyMyAyOS42MzIgMjIuNzQxIDMwLjUyOCAyMi43NDEgMzEuODA4WiIgZmlsbD0iI2ZmZmZmZiIvPjxwYXRoIGQ9Ik02LjI3MiA0OS43OTJDNC4xODEzMyA0OS43OTIgMi42MDI2NyA0OS4yMzczIDEuNTM2IDQ4LjEyOEMwLjUxMiA0Ny4wMTg3IDAgNDUuNjMyIDAgNDMuOTY4VjYuODQ4QzAgNS4wMTMzMyAwLjUxMiAzLjQ5ODY2IDEuNTM2IDIuMzA0QzIuNjAyNjcgMS4wNjY2NiA0LjE4MTMzIDAuNDQ3OTk4IDYuMjcyIDAuNDQ3OTk4QzguMTQ5MzMgMC40NDc5OTggOS42IDEuMDY2NjYgMTAuNjI0IDIuMzA0QzExLjY0OCAzLjQ5ODY2IDEyLjE2IDQuOTcwNjYgMTIuMTYgNi43MlY0My45NjhDMTIuMTYgNDUuNjMyIDExLjY0OCA0Ny4wMTg3IDEwLjYyNCA0OC4xMjhDOS42IDQ5LjIzNzMgOC4xNDkzMyA0OS43OTIgNi4yNzIgNDkuNzkyWiIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPgo=" alt="Loofta" width="134" height="38" style="display:block;border:0;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 24px;font-size:17px;color:#374151;font-weight:500;">You've got money waiting 💸</p>
              <div style="background:#FFF7F5;border:2px solid #FF4A26;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 4px;font-size:13px;color:#FF4A26;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Ready to claim</p>
                <p style="margin:0;font-size:40px;font-weight:800;color:#FF4A26;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              ${fromLine}
              ${descLine}
              <div style="margin-top:32px;text-align:center;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Claim your payment
                </a>
              </div>
              <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;text-align:center;">
                Or copy this link:<br>
                <a href="${data.claimUrl}" style="color:#FF4A26;word-break:break-all;">${data.claimUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #F3F4F6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
                You're receiving this because someone sent you a payment via Loofta.<br>
                <a href="https://pay.loofta.xyz" style="color:#FF4A26;text-decoration:none;">pay.loofta.xyz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
