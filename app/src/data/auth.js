import * as firebase from 'firebase/auth'
import * as local from './sql-auth.js'
import { useLocalSql } from './mode.js'
const provider = useLocalSql ? local : firebase
export const onAuthStateChanged = (...args) => provider.onAuthStateChanged(...args)
export const signInWithEmailAndPassword = (...args) => provider.signInWithEmailAndPassword(...args)
export const signInWithPopup = (...args) => provider.signInWithPopup(...args)
export const signOut = (...args) => provider.signOut(...args)
export const setPersistence = (...args) => provider.setPersistence(...args)
export const browserLocalPersistence = provider.browserLocalPersistence
export const browserSessionPersistence = provider.browserSessionPersistence
