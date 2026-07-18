import { useMemo, useState } from 'react'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ListChecks,
  ShoppingCart,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  recipeQueryOptions,
  recipesQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import { shoppingItemKey } from '@/lib/shopping-aggregate'
import { type RecipeDetail } from '@/server/recipes'
import {
  addRecipeToShopping,
  removeRecipeFromShopping,
} from '@/server/shopping'

/** A line in the picker: one ingredient merged by item key (so the same item in
 *  two components shows once, with its quantities summed), keeping the component
 *  of its first appearance for grouping. */
interface PickLine {
  key: string
  name: string
  unit: string | null
  quantity: number | null
  component: string
}

/** Merge a recipe's ingredients into the unique shopping lines they'd produce,
 *  mirroring the server's by-key merge. Preserves first-appearance order. */
function mergeForPicking(ingredients: RecipeDetail['ingredients']): PickLine[] {
  const map = new Map<string, PickLine>()
  for (const ing of ingredients) {
    const key = shoppingItemKey(ing.name, ing.unit)
    const existing = map.get(key)
    if (existing) {
      if (ing.quantity != null) {
        existing.quantity = (existing.quantity ?? 0) + ing.quantity
      }
    } else {
      map.set(key, {
        key,
        name: ing.name.trim(),
        unit: ing.unit,
        quantity: ing.quantity ?? null,
        component: ing.component?.trim() || '',
      })
    }
  }
  return [...map.values()]
}

function formatAmount(quantity: number | null, unit: string | null) {
  if (quantity == null && !unit) return null
  const qty = quantity == null ? '' : `${+quantity.toFixed(2)}`
  return [qty, unit].filter(Boolean).join(' ')
}

/**
 * The "Legg til handleliste" control as a segmented button: the primary button
 * toggles the whole recipe on/off the list (current behavior), and a ⋯ menu
 * opens a picker to add only some of the ingredients — useful when you already
 * have a few at home. Owns the shopping mutation + optimistic toggle.
 */
export function AddToShoppingMenu({
  recipe,
  scale,
}: {
  recipe: RecipeDetail
  /** Quantity scale factor, owned by the page (ServingsStepper / anchored
   *  ingredient) so the list gets exactly the amounts being displayed. */
  scale: number
}) {
  const queryClient = useQueryClient()
  const [picking, setPicking] = useState(false)
  const recipeKey = recipeQueryOptions(recipe.id).queryKey

  const mutation = useMutation({
    mutationFn: (vars: { inList: boolean; itemKeys?: string[] }) =>
      vars.inList
        ? addRecipeToShopping({
            data: {
              recipeId: recipe.id,
              itemKeys: vars.itemKeys ?? null,
              scale,
            },
          })
        : removeRecipeFromShopping({ data: { recipeId: recipe.id } }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: recipeKey })
      const previous = queryClient.getQueryData<RecipeDetail | null>(recipeKey)
      if (previous) {
        queryClient.setQueryData<RecipeDetail>(recipeKey, {
          ...previous,
          inShoppingList: vars.inList,
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined)
        queryClient.setQueryData(recipeKey, ctx.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: recipesQueryOptions().queryKey })
      queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
    },
  })

  const onList = recipe.inShoppingList
  // The chevron button mirrors the primary button's variant so the segmented
  // control reads as one piece in both states.
  const chevronClass = onList
    ? 'bg-white text-stone-800 ring-1 ring-stone-300 ring-inset data-[hovered]:bg-stone-100 data-[pressed]:bg-stone-200'
    : 'bg-brand-600 text-on-brand border-l border-on-brand/25 data-[hovered]:bg-brand-700 data-[pressed]:bg-brand-800'

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex items-stretch">
        <Button
          variant={onList ? 'secondary' : 'primary'}
          onPress={() => mutation.mutate({ inList: !onList })}
          isDisabled={mutation.isPending}
          className="rounded-r-none"
        >
          {onList ? (
            <>
              <Check className="h-4 w-4" />
              På handlelisten
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" />
              Legg til handleliste
            </>
          )}
        </Button>
        <MenuTrigger>
          <AriaButton
            aria-label="Flere handlelistevalg"
            className={`inline-flex items-center rounded-r-lg px-2 outline-none transition-colors data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-500 ${chevronClass}`}
          >
            <ChevronDown className="h-4 w-4" />
          </AriaButton>
          <Popover className="min-w-[14rem] rounded-lg border border-stone-200 bg-white py-1 shadow-lg outline-none">
            <Menu
              className="outline-none"
              onAction={(key) => key === 'pick' && setPicking(true)}
            >
              <MenuItem
                id="pick"
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[focused]:bg-brand-50 data-[focused]:text-brand-800"
              >
                <ListChecks className="h-4 w-4" />
                Velg varer…
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>

      <ShoppingItemPicker
        isOpen={picking}
        onOpenChange={setPicking}
        ingredients={recipe.ingredients}
        scale={scale}
        onConfirm={(itemKeys) => {
          mutation.mutate({ inList: true, itemKeys })
          setPicking(false)
        }}
      />
    </div>
  )
}

/** Dialog listing a recipe's ingredients (grouped by component) with checkboxes,
 *  all selected by default, so the user can uncheck the ones they don't need
 *  before adding the rest to the list. */
function ShoppingItemPicker({
  isOpen,
  onOpenChange,
  ingredients,
  scale,
  onConfirm,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  ingredients: RecipeDetail['ingredients']
  /** Multiplier applied to displayed amounts so the picker matches what gets
   *  added at the chosen servings. */
  scale: number
  onConfirm: (itemKeys: string[]) => void
}) {
  const lines = useMemo(() => mergeForPicking(ingredients), [ingredients])

  // Selection is keyed; reset to "all selected" whenever the dialog reopens
  // (a fresh open shouldn't remember the previous pick). Keyed on the dialog's
  // open state + the line set.
  const allKeys = useMemo(() => lines.map((l) => l.key), [lines])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allKeys))
  const [seenOpen, setSeenOpen] = useState(false)
  if (isOpen && !seenOpen) {
    setSelected(new Set(allKeys))
    setSeenOpen(true)
  } else if (!isOpen && seenOpen) {
    setSeenOpen(false)
  }

  const groups = useMemo(() => {
    const byComponent = new Map<string, PickLine[]>()
    for (const line of lines) {
      const list = byComponent.get(line.component)
      if (list) list.push(line)
      else byComponent.set(line.component, [line])
    }
    return [...byComponent.entries()].map(([component, items]) => ({
      component,
      items,
    }))
  }, [lines])

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const allSelected = selected.size === lines.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allKeys))

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
    >
      <Modal className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl outline-none">
        <Dialog className="outline-none">
          <Heading slot="title" className="text-lg font-semibold text-stone-900">
            Velg varer til handlelisten
          </Heading>
          <p className="mt-1 text-sm text-stone-500">
            Hak av varene du vil legge til. Fjern haken på det du allerede har.
          </p>

          <div className="mt-3 flex items-center justify-between border-b border-stone-100 pb-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {allSelected ? 'Fjern alle' : 'Velg alle'}
            </button>
            <span className="text-xs text-stone-400">
              {selected.size} av {lines.length} valgt
            </span>
          </div>

          <div className="mt-3 flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.component || '__none'}>
                {group.component && (
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                    {group.component}
                  </h3>
                )}
                <ul className="flex flex-col gap-2">
                  {group.items.map((line) => {
                    const amount = formatAmount(
                      line.quantity == null ? null : line.quantity * scale,
                      line.unit,
                    )
                    return (
                      <li key={line.key}>
                        <Checkbox
                          isSelected={selected.has(line.key)}
                          onChange={() => toggle(line.key)}
                        >
                          <span className="text-stone-800">
                            {amount && (
                              <span className="font-medium">{amount} </span>
                            )}
                            {line.name}
                          </span>
                        </Checkbox>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onPress={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button
              onPress={() => onConfirm([...selected])}
              isDisabled={selected.size === 0}
            >
              Legg til {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
