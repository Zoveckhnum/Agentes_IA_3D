import { ApiError } from './values.mjs'

export function createSecurityMailer(config, fetcher = fetch) {
  return async ({ to, purpose, code }) => {
    if (!config?.apiKey || !config?.sender) throw new ApiError(503, 'auth/mail-unavailable', 'El envío de códigos no está configurado. Contacta al administrador.')
    const action = purpose === 'password' ? 'cambiar tu contraseña' : purpose === 'email-current' ? 'autorizar el cambio de tu correo de acceso' : 'verificar tu nuevo correo de acceso'
    const text = `Tu código de Stackbi Office es: ${code}\n\nÚsalo para ${action}. Vence en 10 minutos y solo puede utilizarse una vez.\n\nSi no solicitaste este cambio, no compartas el código. Tu cuenta conserva sus datos de acceso actuales.`
    let response
    try {
      response = await fetcher('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'api-key': config.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: config.sender, name: config.senderName || 'Stackbi Office' }, to: [{ email: to }], subject: `Código para ${action} · Stackbi Office`, textContent: text, tags: ['seguridad-cuenta'] }),
      })
    } catch { throw new ApiError(503, 'auth/mail-unavailable', 'No se pudo enviar el código. Intenta nuevamente en un minuto.') }
    // Brevo responses can contain private details; never log or expose their body.
    if (!response.ok) throw new ApiError(503, 'auth/mail-unavailable', 'No se pudo enviar el código. Intenta nuevamente en un minuto.')
  }
}
