import { useState } from 'react'
import {
  Button as AriaButton,
  Dialog,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
} from 'react-aria-components'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, FileJson, Plus } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { parseRecipeImport } from '@/components/RecipeForm'

/** sessionStorage handoff: the import modal stashes parsed form values here, and
 *  /recipes/new picks them up to pre-fill the form. */
export const RECIPE_IMPORT_KEY = 'ourrecipes:import-recipe'

/**
 * The "Ny oppskrift" action as a segmented button: the primary link plus a ⋯
 * menu whose one item imports a full recipe from JSON (produced by the
 * `recipe-url-to-json` skill). Importing parses the JSON, then lands on the
 * pre-filled new-recipe form so the result can be reviewed before saving.
 */
export function NewRecipeMenu() {
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const openImport = () => {
    setText('')
    setError(null)
    setImporting(true)
  }

  const doImport = () => {
    const result = parseRecipeImport(text)
    if (!result.ok) {
      setError(result.error)
      return
    }
    sessionStorage.setItem(RECIPE_IMPORT_KEY, JSON.stringify(result.values))
    setImporting(false)
    void navigate({ to: '/recipes/new' })
  }

  return (
    <>
      <div className="inline-flex items-stretch">
        <Link to="/recipes/new">
          <Button className="rounded-r-none">
            <Plus className="h-4 w-4" />
            Ny oppskrift
          </Button>
        </Link>
        <MenuTrigger>
          <AriaButton
            aria-label="Flere måter å lage oppskrift"
            className="inline-flex items-center rounded-r-lg border-l border-white/25 bg-brand-600 px-2 text-white outline-none transition-colors data-[hovered]:bg-brand-700 data-[pressed]:bg-brand-800 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-500"
          >
            <ChevronDown className="h-4 w-4" />
          </AriaButton>
          <Popover className="min-w-[14rem] rounded-lg border border-stone-200 bg-white py-1 shadow-lg outline-none">
            <Menu className="outline-none" onAction={(key) => key === 'json' && openImport()}>
              <MenuItem
                id="json"
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[focused]:bg-brand-50 data-[focused]:text-brand-800"
              >
                <FileJson className="h-4 w-4" />
                Importer fra JSON
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>

      <ModalOverlay
        isOpen={importing}
        onOpenChange={setImporting}
        isDismissable
        className="fixed inset-0 z-30 flex items-start justify-center bg-stone-900/30 p-4 pt-[10vh] backdrop-blur-sm"
      >
        <Modal className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl outline-none">
          <Dialog className="outline-none">
            <Heading slot="title" className="text-lg font-semibold text-stone-900">
              Importer oppskrift fra JSON
            </Heading>
            <p className="mt-1 text-sm text-stone-500">
              Lim inn JSON-objektet fra <code>/recipe-url-to-json</code>. Du får se
              oppskriften i skjemaet før du lagrer.
            </p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (error) setError(null)
              }}
              placeholder={'{\n  "title": "…",\n  "ingredients": [ … ]\n}'}
              rows={10}
              className="mt-3 w-full resize-y rounded-lg border border-stone-300 bg-white p-3 font-mono text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onPress={() => setImporting(false)}>
                Avbryt
              </Button>
              <Button onPress={doImport} isDisabled={text.trim() === ''}>
                Importer
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  )
}
