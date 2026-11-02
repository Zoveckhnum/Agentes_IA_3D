export function configuredRules(template, { owner, robot, emulator = false }) {
  for (const email of [owner, robot]) if (!/^[A-Za-z0-9.!#$%&*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(email || '')) throw new Error('Correo no válido para configurar reglas.')
  return template
    .replace(/function isOwner\(\) \{[^}]*\}/, `function isOwner() {\n      return isAuth() && request.auth.token.email == '${owner.toLowerCase()}' && ownerEmailVerified();\n    }`)
    .replace(/function isAgentBot\(\) \{[^}]*\}/, `function isAgentBot() {\n      return isAuth() && request.auth.token.email == '${robot.toLowerCase()}';\n    }`)
    .replace(/function ownerEmailVerified\(\) \{[^}]*\}/, `function ownerEmailVerified() {\n      return ${emulator ? 'true' : 'request.auth.token.email_verified == true'};\n    }`)
}
