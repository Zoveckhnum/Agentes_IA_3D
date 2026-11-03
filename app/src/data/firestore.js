import * as firebase from 'firebase/firestore'
import * as local from '../../../shared/sql-document-client.mjs'
import { useLocalSql } from './mode.js'
const provider = useLocalSql ? local : firebase
export const doc = (...args) => provider.doc(...args)
export const collection = (...args) => provider.collection(...args)
export const getDoc = (...args) => provider.getDoc(...args)
export const getDocs = (...args) => provider.getDocs(...args)
export const setDoc = (...args) => provider.setDoc(...args)
export const addDoc = (...args) => provider.addDoc(...args)
export const updateDoc = (...args) => provider.updateDoc(...args)
export const deleteDoc = (...args) => provider.deleteDoc(...args)
export const query = (...args) => provider.query(...args)
export const where = (...args) => provider.where(...args)
export const orderBy = (...args) => provider.orderBy(...args)
export const limit = (...args) => provider.limit(...args)
export const onSnapshot = (...args) => provider.onSnapshot(...args)
export const writeBatch = (...args) => provider.writeBatch(...args)
export const serverTimestamp = (...args) => provider.serverTimestamp(...args)
export const increment = (...args) => provider.increment(...args)
export const arrayUnion = (...args) => provider.arrayUnion(...args)
export const arrayRemove = (...args) => provider.arrayRemove(...args)
export const deleteField = (...args) => provider.deleteField(...args)
export const Timestamp = provider.Timestamp
