export function isReadyProfile(profile, uid) {
  return !!profile && profile.uid === uid && typeof profile.email === 'string' && !!profile.email
    && ['admin', 'empleado', 'pending'].includes(profile.role)
}
