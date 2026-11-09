import { describe, it, expect } from 'vitest'
import { indicReading, looksIndic } from './indic'

// Behavioral code-point guards: literal combining marks have been
// mangled by editors before (COENG U+17D2 once landed as U+17B4), so
// every fixture here exercises a specific mechanism of the reading.

describe('indicReading', () => {
    it('reads the varman suffixes and inherent vowels', () => {
        expect(indicReading('មហេន្ទ្រវម៌្ម')).toBe('mahendravarman')
        expect(indicReading('ឝ្រីន្ទ្រវម៌្ម')).toBe('srindravarman')
        expect(indicReading('ជ័យឥន្ទ្រវរ្ម័ន')).toBe('jayaindravarman')
        expect(indicReading('ឧទយាទិត្យវម៌្ម')).toBe('udayadityavarman')
    })

    it('keeps the Sanskrit voiced series', () => {
        expect(indicReading('ពិម្ពិសារ')).toBe('bimbisara')
        expect(indicReading('គវម្បតិ')).toBe('gavampati')
        expect(indicReading('ឧបាលិ')).toBe('upali')
    })

    it('handles the special clusters', () => {
        expect(indicReading('លក្ឝ្មី')).toBe('lakshmi') // ក្ឝ = kṣ
        expect(indicReading('កៅណ្ឌិន្យ')).toBe('kaundinya')
        expect(indicReading('កម្វុជ')).toBe('kambuja') // subscript វ → b
    })

    it('elides a repeated independent vowel', () => {
        expect(indicReading('ស្រីឥន្ទ្រ')).toBe('srindra')
    })
})

describe('looksIndic', () => {
    it('accepts regnal and Pali markers', () => {
        expect(looksIndic('មហេន្ទ្រវម៌្ម')).toBe(true)
        expect(looksIndic('ស្រីឥន្ទ្រវរ្ម័ន')).toBe(true)
        expect(looksIndic('លក្ឝ្មី')).toBe(true)
        expect(looksIndic('ឧបាលិ')).toBe(true)
        expect(looksIndic('ឝ្រីន្ទ្រវម៌្ម')).toBe(true)
    })

    it('rejects modern names', () => {
        expect(looksIndic('សុភា')).toBe(false)
        expect(looksIndic('ចន្តី')).toBe(false)
        expect(looksIndic('ស្រីសុភា')).toBe(false) // initial cluster only
        expect(looksIndic('')).toBe(false)
    })
})
