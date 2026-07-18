import { useState } from 'react'
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from 'react-aria-components'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, FileJson, Plus } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { RecipeImportModal } from '@/components/RecipeImportModal'
import { type RecipeFormValues } from '@/components/RecipeForm'

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

  const onImport = (values: RecipeFormValues) => {
    sessionStorage.setItem(RECIPE_IMPORT_KEY, JSON.stringify(values))
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
            className="inline-flex items-center rounded-r-lg border-l border-on-brand/25 bg-brand-600 px-2 text-on-brand outline-none transition-colors data-[hovered]:bg-brand-700 data-[pressed]:bg-brand-800 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-500"
          >
            <ChevronDown className="h-4 w-4" />
          </AriaButton>
          <Popover className="min-w-[14rem] rounded-lg border border-stone-200 bg-white py-1 shadow-lg outline-none">
            <Menu
              className="outline-none"
              onAction={(key) => key === 'json' && setImporting(true)}
            >
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

      <RecipeImportModal
        isOpen={importing}
        onOpenChange={setImporting}
        onImport={onImport}
      />
    </>
  )
}
