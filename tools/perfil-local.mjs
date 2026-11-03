export async function seedAdminProfile({ ref, email, getDoc, setDoc, serverTimestamp }) {
  const snapshot = await getDoc(ref)
  if (snapshot.exists()) {
    if (snapshot.data().role !== 'admin') await setDoc(ref, { role: 'admin' }, { merge: true })
    return
  }
  await setDoc(ref, { email, name: 'Administrador', role: 'admin', createdAt: serverTimestamp() }, { merge: true })
}
