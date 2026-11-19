import { readFileSync, writeFileSync } from 'node:fs'

const entry = new URL('../dist/index.d.ts', import.meta.url)
const declarations = readFileSync(entry, 'utf8')

// NodeNext resolves the .js specifier to vue-tsc's AgentInput.vue.d.ts.
const finalized = declarations.replace(/(['"])\.\/AgentInput\.vue\1/, '$1./AgentInput.vue.js$1')
writeFileSync(entry, finalized)

const component = new URL('../dist/AgentInput.vue.d.ts', import.meta.url)
const componentDeclarations = readFileSync(component, 'utf8')

// Omit the default TypeRefs and TypeEl arguments that early Vue 3.5 types may lack.
const compatible = componentDeclarations.replace(/(DefineComponent<[\s\S]+?),\s*\{\},\s*any(?=>;)/u, '$1')
writeFileSync(component, compatible)
